import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { events, type User } from '../src/db/schema.js';
import {
  api,
  bearer,
  createBooking,
  createEvent,
  createUser,
  loginAs,
  resetDb,
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
