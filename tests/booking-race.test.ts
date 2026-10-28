import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { bookings, events } from '../src/db/schema.js';
import { api, bearer, createEvent, createUser, loginAs, resetDb } from './helpers.js';

/*
 * The overbooking test: 50 different people try to book the same 10-seat event at the same
 * moment. A correct API sells exactly 10 seats and turns the other 40 away as sold out.
 */

const CAPACITY = 10;
const PEOPLE = 50;

describe('booking under load', () => {
  // repeats: 19 means 20 runs in all: a race that passes once might just have been lucky.
  it(
    `sells exactly ${CAPACITY} seats when ${PEOPLE} people book at once`,
    { repeats: 19, timeout: 20_000 },
    async () => {
      await resetDb();
      const event = await createEvent({ capacity: CAPACITY });
      const people = await Promise.all(Array.from({ length: PEOPLE }, () => createUser()));
      const tokens = await Promise.all(people.map((person) => loginAs(person)));

      // Every request is sent before any response is awaited.
      const responses = await Promise.all(
        tokens.map((token) =>
          api().post(`/api/v1/events/${event.id}/bookings`).set('Authorization', bearer(token)),
        ),
      );

      const [row] = await db.select().from(events).where(eq(events.id, event.id));
      const confirmed = await db.$count(
        bookings,
        and(eq(bookings.eventId, event.id), eq(bookings.status, 'confirmed')),
      );

      expect({
        booked: responses.filter((res) => res.status === 201).length,
        soldOut: responses.filter(
          (res) => res.status === 409 && String(res.body.type).endsWith('#event-sold-out'),
        ).length,
        confirmedBookingsInTheDatabase: confirmed,
        seatsBookedCounter: row?.seatsBooked,
      }).toEqual({
        booked: CAPACITY,
        soldOut: PEOPLE - CAPACITY,
        confirmedBookingsInTheDatabase: CAPACITY,
        seatsBookedCounter: CAPACITY,
      });
    },
  );
});
