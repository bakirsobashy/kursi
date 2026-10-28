import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { events, users, type Event, type User } from '../src/db/schema.js';

const app = createApp();

/** Sends a request to the real app, without opening a port: `await api().get('/health')`. */
export const api = () => request(app);

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
