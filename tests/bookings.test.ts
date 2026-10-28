import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client.js';
import { bookings, events, type User } from '../src/db/schema.js';
import {
  api,
  bearer,
  createBooking,
  createEvent,
  createUser,
  holdRowLock,
  loginAs,
  resetDb,
  waitUntilQueriesAreBlocked,
} from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let user: User;
const as = async (who: User) => bearer(await loginAs(who));
const book = async (eventId: string, who: User = user) =>
  api()
    .post(`/api/v1/events/${eventId}/bookings`)
    .set('Authorization', await as(who));

beforeEach(async () => {
  await resetDb();
  user = await createUser();
});

describe('POST /api/v1/events/:id/bookings', () => {
  it('books a seat and counts it', async () => {
    const event = await createEvent({ capacity: 5, title: 'Workshop' });

    const res = await book(event.id);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: expect.stringMatching(UUID),
      status: 'confirmed',
      cancelledAt: null,
      event: { id: event.id, title: 'Workshop', status: 'published' },
    });
    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    expect(row?.seatsBooked).toBe(1);
  });

  it('returns 409 when the user already holds a seat, and counts nothing extra', async () => {
    const event = await createEvent({ capacity: 5 });
    await book(event.id);

    const res = await book(event.id);

    expect(res.status).toBe(409);
    expect(res.body.type).toMatch(/#already-booked$/);
    const [row] = await db.select().from(events).where(eq(events.id, event.id));
    expect(row?.seatsBooked).toBe(1);
  });

  it('returns 409 sold out when every seat is taken', async () => {
    const event = await createEvent({ capacity: 2 });
    await createBooking(event, await createUser());
    await createBooking(event, await createUser());

    const res = await book(event.id);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      type: expect.stringMatching(/#event-sold-out$/),
      detail: 'All 2 seats for this event are booked.',
    });
  });

  it('returns 404 for a draft, as if it did not exist', async () => {
    const draft = await createEvent({ status: 'draft' });

    expect((await book(draft.id)).status).toBe(404);
  });

  it('returns 404 for an event that does not exist', async () => {
    expect((await book('0199a3c2-0000-7000-8000-00000000ffff')).status).toBe(404);
  });

  it('returns 409 for a cancelled event', async () => {
    const event = await createEvent({ status: 'cancelled' });

    const res = await book(event.id);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      type: expect.stringMatching(/#event-not-bookable$/),
      detail: 'The event is cancelled.',
    });
  });

  it('returns 409 for an event that has already started', async () => {
    const event = await createEvent({ startsAt: new Date(Date.now() - 60_000) });

    const res = await book(event.id);

    expect(res.status).toBe(409);
    expect(res.body.detail).toBe('The event has already started.');
  });

  it('needs a logged-in user', async () => {
    const event = await createEvent();

    expect((await api().post(`/api/v1/events/${event.id}/bookings`)).status).toBe(401);
  });
});

const seatsBooked = async (eventId: string) => {
  const [row] = await db.select().from(events).where(eq(events.id, eventId));
  return row?.seatsBooked;
};

const cancelBooking = async (bookingId: string, who: User = user) =>
  api()
    .post(`/api/v1/bookings/${bookingId}/cancel`)
    .set('Authorization', await as(who));

describe('POST /api/v1/bookings/:id/cancel', () => {
  it('cancels the booking and frees its seat', async () => {
    const event = await createEvent({ capacity: 5 });
    const booked = await book(event.id);

    const res = await cancelBooking(booked.body.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: booked.body.id, status: 'cancelled' });
    expect(res.body.cancelledAt).toEqual(expect.any(String));
    expect(await seatsBooked(event.id)).toBe(0);
  });

  it('lets the user book again after cancelling, keeping the old booking as history', async () => {
    const event = await createEvent({ capacity: 5 });
    const first = await book(event.id);
    await cancelBooking(first.body.id);

    const again = await book(event.id);

    expect(again.status).toBe(201);
    expect(await seatsBooked(event.id)).toBe(1);
    const rows = await db.select().from(bookings).where(eq(bookings.eventId, event.id));
    expect(rows.map((row) => row.status).sort()).toEqual(['cancelled', 'confirmed']);
  });

  it('gives a sold-out seat back, so someone else can book it', async () => {
    const event = await createEvent({ capacity: 1 });
    const booked = await book(event.id);
    const other = await createUser();
    expect((await book(event.id, other)).status).toBe(409);

    await cancelBooking(booked.body.id);

    expect((await book(event.id, other)).status).toBe(201);
  });

  it("returns 404 for someone else's booking, the same as for a missing one", async () => {
    const event = await createEvent();
    const booked = await book(event.id);
    const stranger = await createUser();

    const theirs = await cancelBooking(booked.body.id, stranger);
    const missing = await cancelBooking('0199a3c2-0000-7000-8000-00000000ffff', stranger);

    expect(theirs.status).toBe(404);
    expect(theirs.body.detail).toBe(missing.body.detail);
    expect(await seatsBooked(event.id)).toBe(1);
  });

  it('returns 409 once the event has started, and keeps the seat', async () => {
    const event = await createEvent();
    const booked = await book(event.id);
    await db
      .update(events)
      .set({ startsAt: new Date(Date.now() - 60_000) })
      .where(eq(events.id, event.id));

    const res = await cancelBooking(booked.body.id);

    expect(res.status).toBe(409);
    expect(res.body.type).toMatch(/#event-started$/);
    expect(await seatsBooked(event.id)).toBe(1);
  });

  it('returns 409 the second time, and frees the seat only once', async () => {
    const event = await createEvent();
    const [booked] = [await book(event.id), await book(event.id, await createUser())];

    await cancelBooking(booked.body.id);
    const again = await cancelBooking(booked.body.id);

    expect(again.status).toBe(409);
    expect(again.body.type).toMatch(/#booking-cancelled$/);
    expect(await seatsBooked(event.id)).toBe(1);
  });

  it('frees the seat once when the same booking is cancelled twice at the same moment', async () => {
    const event = await createEvent();
    const booked = await book(event.id);
    await book(event.id, await createUser());
    const token = await as(user);

    // Hold the event's lock so both cancels get past their first check and queue up behind it.
    const lock = await holdRowLock('events', event.id);
    try {
      const cancels = [1, 2].map(() =>
        api()
          .post(`/api/v1/bookings/${booked.body.id}/cancel`)
          .set('Authorization', token)
          .then((res) => res),
      );
      await waitUntilQueriesAreBlocked(2);
      await lock.release();
      const results = await Promise.all(cancels);

      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(await seatsBooked(event.id)).toBe(1);
    } finally {
      await lock.release();
    }
  });

  it('locks the event before touching the booking, the same order as every other write', async () => {
    const event = await createEvent();
    const booked = await book(event.id);

    const lock = await holdRowLock('events', event.id);
    try {
      const cancel = cancelBooking(booked.body.id).then((res) => res);
      await waitUntilQueriesAreBlocked(1);

      // The cancel is waiting for the event, so it must not hold the booking's row yet.
      // NOWAIT fails at once (55P03) if anyone holds it.
      const probe = await pool.connect();
      try {
        await probe.query('BEGIN');
        await probe.query('SELECT 1 FROM bookings WHERE id = $1 FOR UPDATE NOWAIT', [
          booked.body.id,
        ]);
        await probe.query('ROLLBACK');
      } finally {
        probe.release();
      }

      await lock.release();
      expect((await cancel).status).toBe(200);
    } finally {
      await lock.release();
    }
  });

  it("returns 409 for a booking cancelled with its event, and doesn't free seats again", async () => {
    const organizer = await createUser();
    const event = await createEvent({ organizerId: organizer.id });
    const booked = await book(event.id);
    await api()
      .post(`/api/v1/events/${event.id}/cancel`)
      .set('Authorization', await as(organizer));

    const res = await cancelBooking(booked.body.id);

    expect(res.status).toBe(409);
    expect(await seatsBooked(event.id)).toBe(0);
  });

  it('returns 400 for an ID that is not a UUID, and 401 without a token', async () => {
    expect((await cancelBooking('42')).status).toBe(400);
    expect((await api().post('/api/v1/bookings/42/cancel')).status).toBe(401);
  });
});

describe('GET /api/v1/users/me/bookings', () => {
  it("lists the user's own bookings, newest first, with their events", async () => {
    const [meetup, workshop] = [
      await createEvent({ title: 'Meetup' }),
      await createEvent({ title: 'Workshop' }),
    ];
    const first = await book(meetup.id);
    await cancelBooking(first.body.id);
    await book(workshop.id);
    await createBooking(meetup, await createUser()); // someone else's

    const res = await api()
      .get('/api/v1/users/me/bookings')
      .set('Authorization', await as(user));

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 2 });
    expect(
      res.body.data.map((b: { event: { title: string }; status: string }) => [
        b.event.title,
        b.status,
      ]),
    ).toEqual([
      ['Workshop', 'confirmed'],
      ['Meetup', 'cancelled'],
    ]);
  });

  it('pages through the list', async () => {
    for (let i = 0; i < 3; i++) await book((await createEvent()).id);

    const res = await api()
      .get('/api/v1/users/me/bookings?limit=2&page=2')
      .set('Authorization', await as(user));

    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toEqual({ page: 2, limit: 2, total: 3 });
  });

  it('needs a logged-in user', async () => {
    expect((await api().get('/api/v1/users/me/bookings')).status).toBe(401);
  });
});
