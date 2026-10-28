import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { bookings, events, users, type Event, type User } from '../src/db/schema.js';
import { signAccessToken } from '../src/lib/tokens.js';
import { withContractCheck } from './contract.js';

const app = createApp();

/**
 * Sends a request to the real app, without opening a port: `await api().get('/health')`.
 * Every response is checked against the API docs; a mismatch fails the test.
 */
export const api = () => request(withContractCheck(app));

/** Like `api`, for an app built with other options. */
export const apiFor = (customApp: ReturnType<typeof createApp>) =>
  request(withContractCheck(customApp));

/** Empties every table. Call it in beforeEach so each test starts from nothing. */
export async function resetDb() {
  await db.execute(sql`TRUNCATE users, events, bookings, refresh_tokens CASCADE`);
}

export const TEST_PASSWORD = 'correct-horse-battery';

// Hashing with Argon2 is slow on purpose, so do it once per test file, not once per user.
let passwordHash: Promise<string> | undefined;
const hashOnce = () => (passwordHash ??= argon2.hash(TEST_PASSWORD, { type: argon2.argon2id }));

/** Inserts a user whose password is TEST_PASSWORD. Pass overrides for anything else. */
export async function createUser(
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<User> {
  const [user] = await db
    .insert(users)
    .values({
      email: `user-${randomUUID()}@kursi.test`,
      name: 'Test User',
      passwordHash: await hashOnce(),
      ...overrides,
    })
    .returning();
  if (!user) throw new Error('createUser inserted nothing');
  return user;
}

/**
 * A valid access token for the user, signed the same way login signs one. It skips the login
 * endpoint (and its Argon2 check), so tests that only need "a logged-in user" stay fast.
 */
export const loginAs = (user: Pick<User, 'id' | 'role'>) =>
  signAccessToken({ id: user.id, role: user.role });

/** The Authorization header value for a token: `.set('Authorization', bearer(token))`. */
export const bearer = (token: string) => `Bearer ${token}`;

const HOUR_MS = 3_600_000;

/**
 * Inserts an event straight into the database, so tests can create states the API refuses,
 * such as an event that has already started. Defaults: published, 10 seats, starts in 24 hours,
 * lasts 2 hours, organized by a new user.
 */
export async function createEvent(
  overrides: Partial<typeof events.$inferInsert> = {},
): Promise<Event> {
  const { organizerId, startsAt = new Date(Date.now() + 24 * HOUR_MS), ...rest } = overrides;
  const [event] = await db
    .insert(events)
    .values({
      title: 'Test event',
      venue: 'Test venue',
      capacity: 10,
      status: 'published',
      endsAt: new Date(new Date(startsAt).getTime() + 2 * HOUR_MS),
      ...rest,
      startsAt,
      organizerId: organizerId ?? (await createUser()).id,
    })
    .returning();
  if (!event) throw new Error('createEvent inserted nothing');
  return event;
}

/**
 * Inserts a confirmed booking and counts its seat, straight in the database, so tests can
 * set up attendees without going through the booking endpoint.
 */
export async function createBooking(event: Pick<Event, 'id'>, user: Pick<User, 'id'>) {
  const [booking] = await db
    .insert(bookings)
    .values({ eventId: event.id, userId: user.id })
    .returning();
  await db
    .update(events)
    .set({ seatsBooked: sql`${events.seatsBooked} + 1` })
    .where(eq(events.id, event.id));
  if (!booking) throw new Error('createBooking inserted nothing');
  return booking;
}

/** An ISO date-time `hours` from now, for request bodies. */
export const hoursFromNow = (hours: number) => new Date(Date.now() + hours * HOUR_MS).toISOString();

/** The Postgres error behind a failed Drizzle query, such as { code: '23514', constraint: '…' }. */
export async function dbError(query: Promise<unknown>) {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    return cause as { code?: string; constraint?: string };
  }
  throw new Error('Expected the query to fail, but it succeeded');
}

/**
 * Waits until at least `count` queries in the test database are blocked on a lock.
 * Tests use it to force a race: hold a lock in one transaction, send requests, wait here
 * until Postgres shows them waiting, then let go.
 */
export async function waitUntilQueriesAreBlocked(count: number) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const { rows } = await pool.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0]!.waiting >= count) return;
    await sleep(20);
  }
  throw new Error(`Fewer than ${count} queries ever waited on a lock`);
}

/**
 * Locks a row from a separate connection, as another request in the middle of a transaction
 * would. Call `release()` to commit and let the waiting requests through.
 */
export async function holdRowLock(table: 'events' | 'bookings', id: string) {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await client.query('COMMIT');
      client.release();
    },
  };
}
