import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { bookings, events, type Booking, type Event } from '../db/schema.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import type { AuthUser } from '../lib/tokens.js';

type EventSummary = Pick<Event, 'id' | 'title' | 'venue' | 'startsAt' | 'endsAt' | 'status'>;

/** The only shape of a booking the API sends, with the event it is for. */
export function toBookingResponse(booking: Booking, event: EventSummary) {
  return {
    id: booking.id,
    status: booking.status,
    createdAt: booking.createdAt.toISOString(),
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    event: {
      id: event.id,
      title: event.title,
      venue: event.venue,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      status: event.status,
    },
  };
}

const eventNotFound = () => new NotFoundError({ detail: 'No event has this ID.' });

const notBookable = (detail: string) =>
  new ConflictError({ slug: 'event-not-bookable', title: "Event can't be booked", detail });

const soldOut = (capacity: number) =>
  new ConflictError({
    slug: 'event-sold-out',
    title: 'Event is sold out',
    detail: `All ${capacity} seats for this event are booked.`,
  });

const alreadyBooked = () =>
  new ConflictError({
    slug: 'already-booked',
    title: 'Already booked',
    detail: 'You already have a seat at this event.',
  });

/**
 * NAIVE ON PURPOSE (Phase 8, step A): read the event, check for a free seat in TypeScript,
 * insert the booking, then write back the count read earlier plus one. Requests that arrive
 * together all read the same count before any of them writes, so they all get a seat.
 */
export async function bookSeat(eventId: string, user: AuthUser) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event || event.status === 'draft') throw eventNotFound();
  if (event.status === 'cancelled') throw notBookable('The event is cancelled.');
  if (event.startsAt <= new Date()) throw notBookable('The event has already started.');
  if (event.seatsBooked >= event.capacity) throw soldOut(event.capacity);

  try {
    const [booking] = await db.insert(bookings).values({ eventId, userId: user.id }).returning();
    await db
      .update(events)
      .set({ seatsBooked: event.seatsBooked + 1 })
      .where(eq(events.id, eventId));
    return toBookingResponse(booking!, event);
  } catch (error) {
    if (isUniqueViolation(error, 'bookings_one_confirmed_per_user_idx')) throw alreadyBooked();
    throw error;
  }
}
