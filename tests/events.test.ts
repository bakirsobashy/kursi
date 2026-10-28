import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { bookings, events, type Event, type User } from '../src/db/schema.js';
import {
  api,
  bearer,
  createBooking,
  createEvent,
  createUser,
  hoursFromNow,
  loginAs,
  resetDb,
} from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const validEvent = () => ({
  title: 'Baghdad Node.js Meetup',
  description: 'Talks and pizza.',
  venue: 'Karrada',
  startsAt: hoursFromNow(48),
  endsAt: hoursFromNow(51),
  capacity: 50,
});

let organizer: User;
let stranger: User;
let admin: User;
const as = async (user: User) => bearer(await loginAs(user));

beforeEach(async () => {
  await resetDb();
  [organizer, stranger, admin] = [
    await createUser({ name: 'Organizer' }),
    await createUser({ name: 'Stranger' }),
    await createUser({ name: 'Admin', role: 'admin' }),
  ];
});

describe('POST /api/v1/events', () => {
  it('creates a draft owned by the caller, with every seat free', async () => {
    const res = await api()
      .post('/api/v1/events')
      .set('Authorization', await as(organizer))
      .send(validEvent());

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/events/${res.body.id}`);
    expect(res.body).toMatchObject({
      id: expect.stringMatching(UUID),
      organizerId: organizer.id,
      title: 'Baghdad Node.js Meetup',
      status: 'draft',
      capacity: 50,
      seatsBooked: 0,
      seatsLeft: 50,
    });
  });

  it('ignores organizerId, status and seatsBooked sent in the body', async () => {
    const res = await api()
      .post('/api/v1/events')
      .set('Authorization', await as(organizer))
      .send({ ...validEvent(), organizerId: stranger.id, status: 'published', seatsBooked: 49 });

    expect(res.body).toMatchObject({ organizerId: organizer.id, status: 'draft', seatsBooked: 0 });
  });

  it('accepts a time-zone offset and answers in UTC', async () => {
    const res = await api()
      .post('/api/v1/events')
      .set('Authorization', await as(organizer))
      .send({
        ...validEvent(),
        startsAt: '2030-01-15T19:00:00+03:00',
        endsAt: '2030-01-15T22:00:00+03:00',
      });

    expect(res.body.startsAt).toBe('2030-01-15T16:00:00.000Z');
  });

  it('needs a logged-in user', async () => {
    const res = await api().post('/api/v1/events').send(validEvent());

    expect(res.status).toBe(401);
  });

  type Body = ReturnType<typeof validEvent>;
  it.each<[string, (body: Body) => object, string]>([
    ['a title under 3 characters', () => ({ title: 'Go' }), 'title'],
    ['a start time in the past', () => ({ startsAt: hoursFromNow(-1) }), 'startsAt'],
    ['an end before the start', () => ({ endsAt: hoursFromNow(47) }), 'endsAt'],
    ['an end equal to the start', (body) => ({ endsAt: body.startsAt }), 'endsAt'],
    ['a date without a time zone', () => ({ startsAt: '2030-01-15T19:00:00' }), 'startsAt'],
    ['a capacity of 0', () => ({ capacity: 0 }), 'capacity'],
    ['a capacity over 10,000', () => ({ capacity: 10_001 }), 'capacity'],
    ['a capacity as text', () => ({ capacity: '50' }), 'capacity'],
    ['a missing venue', () => ({ venue: undefined }), 'venue'],
  ])('returns 400 for %s', async (_case, change, field) => {
    const valid = validEvent();
    const body = { ...valid, ...change(valid) };

    const res = await api()
      .post('/api/v1/events')
      .set('Authorization', await as(organizer))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toContain(field);
  });
});

describe('GET /api/v1/events/:id', () => {
  it('shows a published event to anyone, without logging in', async () => {
    const event = await createEvent({ organizerId: organizer.id });

    const res = await api().get(`/api/v1/events/${event.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(event.id);
  });

  it('still shows a cancelled event, so attendees can see what happened', async () => {
    const event = await createEvent({ status: 'cancelled' });

    expect((await api().get(`/api/v1/events/${event.id}`)).body.status).toBe('cancelled');
  });

  it('hides a draft from everyone but its organizer and admins, as a 404', async () => {
    const draft = await createEvent({ organizerId: organizer.id, status: 'draft' });
    const path = `/api/v1/events/${draft.id}`;

    expect((await api().get(path)).status).toBe(404);
    expect(
      (
        await api()
          .get(path)
          .set('Authorization', await as(stranger))
      ).status,
    ).toBe(404);
    expect(
      (
        await api()
          .get(path)
          .set('Authorization', await as(organizer))
      ).status,
    ).toBe(200);
    expect(
      (
        await api()
          .get(path)
          .set('Authorization', await as(admin))
      ).status,
    ).toBe(200);
  });

  it('returns the same 404 for a draft as for an event that never existed', async () => {
    const draft = await createEvent({ status: 'draft' });

    const hidden = await api().get(`/api/v1/events/${draft.id}`);
    const missing = await api().get('/api/v1/events/0199a3c2-0000-7000-8000-00000000ffff');

    expect(hidden.status).toBe(404);
    expect(hidden.body.detail).toBe(missing.body.detail);
  });

  it('returns 400 for an ID that is not a UUID', async () => {
    const res = await api().get('/api/v1/events/42');

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'id', message: 'must be a UUID' }]);
  });

  it('returns 401 for a bad token rather than quietly treating the caller as anonymous', async () => {
    const event = await createEvent();

    const res = await api()
      .get(`/api/v1/events/${event.id}`)
      .set('Authorization', 'Bearer nonsense');

    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/v1/events/:id', () => {
  let event: Event;

  beforeEach(async () => {
    event = await createEvent({ organizerId: organizer.id, capacity: 10 });
  });

  const patch = async (body: object, user: User = organizer, id = event.id) =>
    api()
      .patch(`/api/v1/events/${id}`)
      .set('Authorization', await as(user))
      .send(body);

  it('lets the organizer change fields, leaving the rest alone', async () => {
    const res = await patch({ title: 'A better title', capacity: 20 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'A better title', capacity: 20, venue: 'Test venue' });
  });

  it('lets an admin edit any event', async () => {
    expect((await patch({ title: 'Edited by an admin' }, admin)).status).toBe(200);
  });

  it("returns 403 for someone else's published event", async () => {
    const res = await patch({ title: 'Hijacked' }, stranger);

    expect(res.status).toBe(403);
    expect(res.body.type).toMatch(/#forbidden$/);
  });

  it("returns 404 for someone else's draft, so the draft stays secret", async () => {
    const draft = await createEvent({ organizerId: organizer.id, status: 'draft' });

    expect((await patch({ title: 'Hijacked' }, stranger, draft.id)).status).toBe(404);
  });

  it('returns 409 when capacity would drop below the seats already booked', async () => {
    for (let i = 0; i < 3; i++) await createBooking(event, await createUser());

    const res = await patch({ capacity: 2 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      type: expect.stringMatching(/#capacity-below-bookings$/),
      detail: "3 seats are already booked, so capacity can't go below that.",
    });
  });

  it('allows a capacity equal to the seats already booked', async () => {
    for (let i = 0; i < 3; i++) await createBooking(event, await createUser());

    const res = await patch({ capacity: 3 });

    expect(res.status).toBe(200);
    expect(res.body.seatsLeft).toBe(0);
  });

  it('returns 400 when a new end time falls before the existing start time', async () => {
    const res = await patch({ endsAt: new Date(event.startsAt.getTime() - 60_000).toISOString() });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'endsAt', message: 'must be after startsAt' }]);
  });

  it('returns 400 for an empty body or a start time in the past', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ startsAt: hoursFromNow(-2) })).status).toBe(400);
  });

  it('can clear the description with null', async () => {
    const res = await patch({ description: null });

    expect(res.body.description).toBeNull();
  });

  it('returns 409 for a cancelled event', async () => {
    await db.update(events).set({ status: 'cancelled' }).where(eq(events.id, event.id));

    const res = await patch({ title: 'Too late' });

    expect(res.status).toBe(409);
    expect(res.body.type).toMatch(/#event-cancelled$/);
  });
});

describe('POST /api/v1/events/:id/publish', () => {
  const publish = async (id: string, user: User = organizer) =>
    api()
      .post(`/api/v1/events/${id}/publish`)
      .set('Authorization', await as(user));

  it('publishes a draft', async () => {
    const draft = await createEvent({ organizerId: organizer.id, status: 'draft' });

    const res = await publish(draft.id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
  });

  it('returns 409 the second time, because only drafts can be published', async () => {
    const draft = await createEvent({ organizerId: organizer.id, status: 'draft' });
    await publish(draft.id);

    const res = await publish(draft.id);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      type: expect.stringMatching(/#event-not-draft$/),
      detail: 'This event is published.',
    });
  });

  it('returns 409 for a cancelled event', async () => {
    const cancelled = await createEvent({ organizerId: organizer.id, status: 'cancelled' });

    expect((await publish(cancelled.id)).body.type).toMatch(/#event-not-draft$/);
  });

  it('returns 409 for a draft whose start time has passed', async () => {
    const stale = await createEvent({
      organizerId: organizer.id,
      status: 'draft',
      startsAt: new Date(Date.now() - 3_600_000),
    });

    const res = await publish(stale.id);

    expect(res.status).toBe(409);
    expect(res.body.type).toMatch(/#event-started$/);
  });

  it("refuses someone else's draft with a 404 and lets an admin publish it", async () => {
    const draft = await createEvent({ organizerId: organizer.id, status: 'draft' });

    expect((await publish(draft.id, stranger)).status).toBe(404);
    expect((await publish(draft.id, admin)).status).toBe(200);
  });
});

describe('POST /api/v1/events/:id/cancel', () => {
  const cancel = async (id: string, user: User = organizer) =>
    api()
      .post(`/api/v1/events/${id}/cancel`)
      .set('Authorization', await as(user));

  it('cancels the event and its confirmed bookings, and frees every seat', async () => {
    const event = await createEvent({ organizerId: organizer.id });
    await createBooking(event, await createUser());
    await createBooking(event, await createUser());

    const res = await cancel(event.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'cancelled', seatsBooked: 0 });
    const rows = await db.select().from(bookings).where(eq(bookings.eventId, event.id));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe('cancelled');
      expect(row.cancelledAt).toBeInstanceOf(Date);
    }
  });

  it("leaves other events' bookings alone", async () => {
    const [event, other] = [
      await createEvent({ organizerId: organizer.id }),
      await createEvent({ organizerId: organizer.id }),
    ];
    const kept = await createBooking(other, await createUser());

    await cancel(event.id);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, kept.id));
    expect(row?.status).toBe('confirmed');
  });

  it('can cancel a draft', async () => {
    const draft = await createEvent({ organizerId: organizer.id, status: 'draft' });

    expect((await cancel(draft.id)).body.status).toBe('cancelled');
  });

  it('returns 409 when the event is already cancelled', async () => {
    const event = await createEvent({ organizerId: organizer.id });
    await cancel(event.id);

    const res = await cancel(event.id);

    expect(res.status).toBe(409);
    expect(res.body.type).toMatch(/#event-cancelled$/);
  });

  it('returns 403 for a stranger and lets an admin cancel', async () => {
    const event = await createEvent({ organizerId: organizer.id });

    expect((await cancel(event.id, stranger)).status).toBe(403);
    expect((await cancel(event.id, admin)).status).toBe(200);
  });
});

describe('GET /api/v1/events', () => {
  const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000);
  const titles = (res: { body: { data: { title: string }[] } }) =>
    res.body.data.map((e) => e.title);

  it('lists only published events that have not started yet', async () => {
    await createEvent({ title: 'Upcoming', startsAt: inHours(5) });
    await createEvent({ title: 'Draft', status: 'draft', startsAt: inHours(5) });
    await createEvent({ title: 'Cancelled', status: 'cancelled', startsAt: inHours(5) });
    await createEvent({ title: 'Started', startsAt: inHours(-1) });

    const res = await api().get('/api/v1/events');

    expect(res.status).toBe(200);
    expect(titles(res)).toEqual(['Upcoming']);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 1 });
  });

  it('sorts by start time, then by ID for events that start together', async () => {
    const sameTime = inHours(10);
    await createEvent({ title: 'Later', startsAt: inHours(20) });
    // Inserted in the opposite order to their IDs, so only the ID tiebreak puts A first.
    await createEvent({
      id: '0199a3c2-0000-7000-8000-0000000000b2',
      title: 'Tie B',
      startsAt: sameTime,
    });
    await createEvent({
      id: '0199a3c2-0000-7000-8000-0000000000b1',
      title: 'Tie A',
      startsAt: sameTime,
    });
    await createEvent({ title: 'Sooner', startsAt: inHours(2) });

    const res = await api().get('/api/v1/events');

    expect(titles(res)).toEqual(['Sooner', 'Tie A', 'Tie B', 'Later']);
  });

  it('pages through the results', async () => {
    for (let i = 1; i <= 5; i++) await createEvent({ title: `Event ${i}`, startsAt: inHours(i) });

    const page2 = await api().get('/api/v1/events?limit=2&page=2');
    const past = await api().get('/api/v1/events?limit=2&page=4');

    expect(titles(page2)).toEqual(['Event 3', 'Event 4']);
    expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 5 });
    expect(past.body).toEqual({ data: [], meta: { page: 4, limit: 2, total: 5 } });
  });

  it.each([
    ['limit=500', 'limit'],
    ['limit=0', 'limit'],
    ['page=0', 'page'],
    ['page=two', 'page'],
    ['from=yesterday', 'from'],
    [
      `from=${encodeURIComponent(hoursFromNow(10))}&to=${encodeURIComponent(hoursFromNow(5))}`,
      'to',
    ],
  ])('returns 400 for ?%s', async (query, field) => {
    const res = await api().get(`/api/v1/events?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toContain(field);
  });

  it('filters by start time with from and to, and never lists past events', async () => {
    await createEvent({ title: 'In 2 hours', startsAt: inHours(2) });
    await createEvent({ title: 'In 2 days', startsAt: inHours(48) });
    await createEvent({ title: 'In 2 weeks', startsAt: inHours(336) });
    await createEvent({ title: 'Started', startsAt: inHours(-1) });
    const range = (from: number, to: number) =>
      `from=${encodeURIComponent(hoursFromNow(from))}&to=${encodeURIComponent(hoursFromNow(to))}`;

    expect(titles(await api().get(`/api/v1/events?${range(24, 100)}`))).toEqual(['In 2 days']);
    expect(titles(await api().get(`/api/v1/events?${range(-48, 3)}`))).toEqual(['In 2 hours']);
  });

  it('searches titles without regard to case', async () => {
    await createEvent({ title: 'Node.js Meetup' });
    await createEvent({ title: 'Intro to PostgreSQL' });

    expect(titles(await api().get('/api/v1/events?q=NODE'))).toEqual(['Node.js Meetup']);
  });

  it('treats % and _ in a search as plain characters', async () => {
    await createEvent({ title: '100% Fun' });
    await createEvent({ title: '100 Fun' });
    await createEvent({ title: 'snake_case talk' });
    await createEvent({ title: 'snakescase talk' });

    expect(titles(await api().get('/api/v1/events?q=100%25'))).toEqual(['100% Fun']);
    expect(titles(await api().get('/api/v1/events?q=snake_'))).toEqual(['snake_case talk']);
  });
});

describe('GET /api/v1/events/:id/bookings', () => {
  it('shows the organizer the confirmed attendees, not the cancelled ones', async () => {
    const event = await createEvent({ organizerId: organizer.id });
    const ali = await createUser({ name: 'Ali', email: 'ali@kursi.test' });
    await createBooking(event, ali);
    const gone = await createBooking(event, await createUser());
    await db
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(bookings.id, gone.id));

    const res = await api()
      .get(`/api/v1/events/${event.id}/bookings`)
      .set('Authorization', await as(organizer));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        {
          bookingId: expect.stringMatching(UUID),
          bookedAt: expect.any(String),
          user: { id: ali.id, name: 'Ali', email: 'ali@kursi.test' },
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
    });
  });

  it('returns 403 for a stranger, 401 without a token, and 200 for an admin', async () => {
    const event = await createEvent({ organizerId: organizer.id });
    const path = `/api/v1/events/${event.id}/bookings`;

    expect(
      (
        await api()
          .get(path)
          .set('Authorization', await as(stranger))
      ).status,
    ).toBe(403);
    expect((await api().get(path)).status).toBe(401);
    expect(
      (
        await api()
          .get(path)
          .set('Authorization', await as(admin))
      ).status,
    ).toBe(200);
  });
});
