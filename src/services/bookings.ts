import { and, eq, gt, lt, sql } from 'drizzle-orm';
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
 * Books one seat, safely under any number of simultaneous requests.
 *
 * The seat is taken by one conditional UPDATE: "add 1 to seats_booked, but only if a seat is
 * free and the event is published and upcoming". The UPDATE locks the event row, so a second
 * request for the same event waits for the first to commit, then re-checks the WHERE clause
 * against the new count. No request can act on a stale count, so no event is ever oversold.
 *
 * The booking row is inserted in the same transaction. If the user already holds a seat, the
 * partial unique index refuses the insert, and the rollback also undoes the seat it took.
 */
export async function bookSeat(eventId: string, user: AuthUser) {
  let booked;
  try {
    booked = await db.transaction(async (tx) => {
      const [event] = await tx
        .update(events)
        .set({ seatsBooked: sql`${events.seatsBooked} + 1` })
        .where(
          and(
            eq(events.id, eventId),
            eq(events.status, 'published'),
            gt(events.startsAt, sql`now()`),
            lt(events.seatsBooked, events.capacity),
          ),
        )
        .returning();
      // No seat taken, nothing written: end the transaction and explain outside it.
      if (!event) return undefined;

      const [booking] = await tx.insert(bookings).values({ eventId, userId: user.id }).returning();
      return toBookingResponse(booking!, event);
    });
  } catch (error) {
    if (isUniqueViolation(error, 'bookings_one_confirmed_per_user_idx')) throw alreadyBooked();
    throw error;
  }

  // Explaining needs a query of its own. Run inside the transaction on a second connection,
  // it would deadlock the pool under load: every connection held by a transaction that waits
  // for a free connection. Run here, after the transaction has released its connection.
  if (!booked) throw await whyNotBookable(eventId, user);
  return booked;
}

/**
 * Runs only after the conditional UPDATE matched nothing, to tell the caller why.
 * It decides nothing: the UPDATE already refused the seat.
 */
async function whyNotBookable(eventId: string, user: AuthUser) {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  if (!event || event.status === 'draft') return eventNotFound();
  if (event.status === 'cancelled') return notBookable('The event is cancelled.');
  if (event.startsAt <= new Date()) return notBookable('The event has already started.');

  // A full event the user is already booked on: "already booked" says more than "sold out".
  const held = await db.$count(
    bookings,
    and(
      eq(bookings.eventId, eventId),
      eq(bookings.userId, user.id),
      eq(bookings.status, 'confirmed'),
    ),
  );
  return held > 0 ? alreadyBooked() : soldOut(event.capacity);
}
