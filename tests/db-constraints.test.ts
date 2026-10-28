import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { bookings, events, refreshTokens, users } from '../src/db/schema.js';
import { createEvent, createUser, dbError, resetDb } from './helpers.js';

// These tests write straight to the database, past any application code,
// to prove the database itself refuses data that breaks the rules.

beforeEach(async () => {
  await resetDb();
});

describe('events', () => {
  it('refuses seats_booked above capacity', async () => {
    const event = await createEvent({ capacity: 3 });

    const error = await dbError(
      db.update(events).set({ seatsBooked: 4 }).where(eq(events.id, event.id)),
    );

    expect(error).toMatchObject({ code: '23514', constraint: 'events_seats_within_capacity' });
  });

  it('refuses a negative seats_booked', async () => {
    const event = await createEvent();

    const error = await dbError(
      db.update(events).set({ seatsBooked: -1 }).where(eq(events.id, event.id)),
    );

    expect(error).toMatchObject({ code: '23514', constraint: 'events_seats_within_capacity' });
  });

  it('refuses a capacity of 0', async () => {
    const error = await dbError(createEvent({ capacity: 0 }));

    expect(error).toMatchObject({ code: '23514', constraint: 'events_capacity_positive' });
  });

  it('refuses an event that ends before it starts', async () => {
    const startsAt = new Date(Date.now() + 86_400_000);

    const error = await dbError(
      createEvent({ startsAt, endsAt: new Date(startsAt.getTime() - 60_000) }),
    );

    expect(error).toMatchObject({ code: '23514', constraint: 'events_ends_after_starts' });
  });

  it('refuses an organizer who does not exist', async () => {
    const error = await dbError(
      createEvent({ organizerId: '0199a3c2-0000-7000-8000-00000000ffff' }),
    );

    expect(error).toMatchObject({ code: '23503' });
  });

  it('starts as a draft with no seats booked when nothing else is said', async () => {
    const organizer = await createUser();
    const [event] = await db
      .insert(events)
      .values({
        organizerId: organizer.id,
        title: 'Defaults',
        venue: 'Here',
        capacity: 5,
        startsAt: new Date(Date.now() + 86_400_000),
        endsAt: new Date(Date.now() + 90_000_000),
      })
      .returning();

    expect(event).toMatchObject({ status: 'draft', seatsBooked: 0 });
  });
});

describe('bookings', () => {
  it('refuses a second confirmed booking for the same user and event', async () => {
    const [user, event] = [await createUser(), await createEvent()];
    await db.insert(bookings).values({ eventId: event.id, userId: user.id });

    const error = await dbError(db.insert(bookings).values({ eventId: event.id, userId: user.id }));

    expect(error).toMatchObject({
      code: '23505',
      constraint: 'bookings_one_confirmed_per_user_idx',
    });
  });

  it('allows booking again after the first booking is cancelled, keeping it as history', async () => {
    const [user, event] = [await createUser(), await createEvent()];
    const [first] = await db
      .insert(bookings)
      .values({ eventId: event.id, userId: user.id })
      .returning();
    await db
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(bookings.id, first!.id));

    await db.insert(bookings).values({ eventId: event.id, userId: user.id });

    const rows = await db.select().from(bookings).where(eq(bookings.userId, user.id));
    expect(rows.map((row) => row.status).sort()).toEqual(['cancelled', 'confirmed']);
  });

  it('allows the same user to book different events', async () => {
    const user = await createUser();
    const [a, b] = [await createEvent(), await createEvent()];

    await db.insert(bookings).values([
      { eventId: a.id, userId: user.id },
      { eventId: b.id, userId: user.id },
    ]);

    expect(await db.$count(bookings, eq(bookings.userId, user.id))).toBe(2);
  });

  it('refuses a cancelled booking without cancelled_at, and the reverse', async () => {
    const [user, event] = [await createUser(), await createEvent()];

    const cancelledWithoutDate = await dbError(
      db.insert(bookings).values({ eventId: event.id, userId: user.id, status: 'cancelled' }),
    );
    const confirmedWithDate = await dbError(
      db.insert(bookings).values({ eventId: event.id, userId: user.id, cancelledAt: new Date() }),
    );

    for (const error of [cancelledWithoutDate, confirmedWithDate]) {
      expect(error).toMatchObject({
        code: '23514',
        constraint: 'bookings_cancelled_at_matches_status',
      });
    }
  });
});

describe('users', () => {
  it('refuses an email that is not lowercase', async () => {
    const error = await dbError(createUser({ email: 'Ali@Kursi.test' }));

    expect(error).toMatchObject({ code: '23514', constraint: 'users_email_lowercase' });
  });

  it('refuses a duplicate email', async () => {
    await createUser({ email: 'ali@kursi.test' });

    const error = await dbError(createUser({ email: 'ali@kursi.test' }));

    expect(error).toMatchObject({ code: '23505', constraint: 'users_email_unique' });
  });

  it('gives new rows time-ordered UUIDv7 IDs', async () => {
    const user = await createUser();

    const [row] = await db
      .execute<{ version: number }>(sql`select uuid_extract_version(${user.id}::uuid) as version`)
      .then((result) => result.rows);

    expect(row?.version).toBe(7);
  });

  it("deletes a user's refresh tokens along with the user", async () => {
    const user = await createUser();
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: 'hash-of-a-token',
      familyId: '0199a3c2-0000-7000-8000-0000000000aa',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await db.delete(users).where(eq(users.id, user.id));

    expect(await db.$count(refreshTokens)).toBe(0);
  });
});
