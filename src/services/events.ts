import { and, asc, eq, gt, gte, ilike, lte, ne, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { pgErrorOf } from '../db/errors.js';
import { bookings, events, users, type Event } from '../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import type { AuthUser } from '../lib/tokens.js';
import {
  eventTimes,
  type CreateEventBody,
  type ListEventsQuery,
  type Pagination,
  type UpdateEventBody,
} from '../schemas/events.js';

/** The only shape of an event the API sends. */
export function toEventResponse(event: Event) {
  return {
    id: event.id,
    organizerId: event.organizerId,
    title: event.title,
    description: event.description,
    venue: event.venue,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    capacity: event.capacity,
    seatsBooked: event.seatsBooked,
    seatsLeft: event.capacity - event.seatsBooked,
    status: event.status,
    createdAt: event.createdAt.toISOString(),
  };
}

export type EventResponse = ReturnType<typeof toEventResponse>;

const eventNotFound = () => new NotFoundError({ detail: 'No event has this ID.' });

const canManage = (event: Event, user: AuthUser | undefined) =>
  user !== undefined && (user.role === 'admin' || event.organizerId === user.id);

/**
 * The organizer or an admin may manage an event; anyone else gets a 403. Someone else's
 * draft gets a 404 instead, so nobody can find out that an unpublished event exists.
 */
export function assertCanManage(event: Event, user: AuthUser) {
  if (canManage(event, user)) return;
  if (event.status === 'draft') throw eventNotFound();
  throw new ForbiddenError({ detail: 'Only the organizer or an admin can manage this event.' });
}

async function findEvent(id: string) {
  const [event] = await db.select().from(events).where(eq(events.id, id));
  if (!event) throw eventNotFound();
  return event;
}

/** Loads an event for its organizer or an admin, applying the rules of assertCanManage. */
async function findEventToManage(id: string, user: AuthUser) {
  const event = await findEvent(id);
  assertCanManage(event, user);
  return event;
}

const cancelledConflict = (detail: string) =>
  new ConflictError({ slug: 'event-cancelled', title: 'Event is cancelled', detail });

export async function createEvent(input: CreateEventBody, organizer: AuthUser) {
  // The organizer and the starting state come from the server, never from the request body.
  const [event] = await db
    .insert(events)
    .values({ ...input, organizerId: organizer.id, status: 'draft' })
    .returning();
  return toEventResponse(event!);
}

/** Any published or cancelled event; a draft only for its organizer or an admin. */
export async function getEvent(id: string, viewer: AuthUser | undefined) {
  const event = await findEvent(id);
  if (event.status === 'draft' && !canManage(event, viewer)) throw eventNotFound();
  return toEventResponse(event);
}

export async function updateEvent(id: string, patch: UpdateEventBody, user: AuthUser) {
  const event = await findEventToManage(id, user);
  if (event.status === 'cancelled') {
    throw cancelledConflict('A cancelled event can no longer be edited.');
  }

  // A patch may move only one end of the event, so check the times as they'll end up.
  eventTimes.parse({
    startsAt: patch.startsAt ?? event.startsAt,
    endsAt: patch.endsAt ?? event.endsAt,
  });

  try {
    const [updated] = await db.update(events).set(patch).where(eq(events.id, id)).returning();
    return toEventResponse(updated!);
  } catch (error) {
    // The CHECK constraint decides, so a booking that lands mid-update can't slip past it.
    if (pgErrorOf(error)?.constraint === 'events_seats_within_capacity') {
      throw new ConflictError({
        slug: 'capacity-below-bookings',
        title: 'Capacity is below the seats already booked',
        detail: `${event.seatsBooked} seats are already booked, so capacity can't go below that.`,
      });
    }
    throw error;
  }
}

/** Draft to published. The status check is part of the UPDATE, so two publishes can't both run. */
export async function publishEvent(id: string, user: AuthUser) {
  const event = await findEventToManage(id, user);
  if (event.startsAt <= new Date()) {
    throw new ConflictError({
      slug: 'event-started',
      title: 'Event has already started',
      detail: 'Change the start time to the future before publishing.',
    });
  }

  const [published] = await db
    .update(events)
    .set({ status: 'published' })
    .where(and(eq(events.id, id), eq(events.status, 'draft')))
    .returning();
  if (!published) {
    throw new ConflictError({
      slug: 'event-not-draft',
      title: 'Only a draft can be published',
      detail: `This event is ${event.status}.`,
    });
  }
  return toEventResponse(published);
}

/**
 * Cancels the event and every confirmed booking for it, in one transaction: either all of it
 * happens or none of it does. The event row is updated (and so locked) first, the same order
 * booking will use, which keeps the two from deadlocking.
 */
export async function cancelEvent(id: string, user: AuthUser) {
  await findEventToManage(id, user);

  return db.transaction(async (tx) => {
    const [cancelled] = await tx
      .update(events)
      .set({ status: 'cancelled', seatsBooked: 0 })
      .where(and(eq(events.id, id), ne(events.status, 'cancelled')))
      .returning();
    if (!cancelled) throw cancelledConflict('This event is already cancelled.');

    await tx
      .update(bookings)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(and(eq(bookings.eventId, id), eq(bookings.status, 'confirmed')));

    return toEventResponse(cancelled);
  });
}

/** Escapes LIKE's wildcards, so a search for "100%" finds that text, not everything after "100". */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** Published events that haven't started yet, soonest first. */
export async function listEvents({ page, limit, from, to, q }: ListEventsQuery) {
  const now = new Date();
  const conditions: (SQL | undefined)[] = [
    eq(events.status, 'published'),
    from && from > now ? gte(events.startsAt, from) : gt(events.startsAt, now),
    to ? lte(events.startsAt, to) : undefined,
    q ? ilike(events.title, `%${escapeLike(q)}%`) : undefined,
  ];
  const where = and(...conditions);

  const [rows, total] = await Promise.all([
    db
      .select()
      .from(events)
      .where(where)
      // id breaks ties, so pages never repeat or skip events that start at the same time.
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.$count(events, where),
  ]);

  return { data: rows.map(toEventResponse), meta: { page, limit, total } };
}

/** The confirmed bookings of an event, for its organizer or an admin. */
export async function listAttendees(id: string, user: AuthUser, { page, limit }: Pagination) {
  await findEventToManage(id, user);
  const where = and(eq(bookings.eventId, id), eq(bookings.status, 'confirmed'));

  const [rows, total] = await Promise.all([
    db
      .select({
        bookingId: bookings.id,
        bookedAt: bookings.createdAt,
        userId: users.id,
        name: users.name,
        email: users.email,
      })
      .from(bookings)
      .innerJoin(users, eq(users.id, bookings.userId))
      .where(where)
      .orderBy(asc(bookings.createdAt), asc(bookings.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db.$count(bookings, where),
  ]);

  return {
    data: rows.map((row) => ({
      bookingId: row.bookingId,
      bookedAt: row.bookedAt.toISOString(),
      user: { id: row.userId, name: row.name, email: row.email },
    })),
    meta: { page, limit, total },
  };
}
