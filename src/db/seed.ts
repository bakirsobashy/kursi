import argon2 from 'argon2';
import { logger } from '../lib/logger.js';
import { closeDb, db } from './client.js';
import { DEMO_EMAILS, DEMO_IDS, DEMO_PASSWORD } from './demo.js';
import { bookings, events, users } from './schema.js';

/*
 * Demo data for local development and the Swagger "Try it out" buttons.
 * Every row has a fixed ID and is inserted with ON CONFLICT DO NOTHING,
 * so running the seed twice changes nothing.
 */

const ids = DEMO_IDS;

/** A time `days` from now, on the hour, in UTC. Relative dates keep the demo events upcoming. */
function daysFromNow(days: number, hourUtc: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date;
}

/** Inserts the demo rows that are missing and returns how many of each it added. */
export async function seed() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  return db.transaction(async (tx) => {
    const newUsers = await tx
      .insert(users)
      .values([
        {
          id: ids.admin,
          email: DEMO_EMAILS.admin,
          name: 'Kursi Admin',
          role: 'admin',
          passwordHash,
        },
        { id: ids.alice, email: DEMO_EMAILS.alice, name: 'Alice Organizer', passwordHash },
        { id: ids.bob, email: DEMO_EMAILS.bob, name: 'Bob Organizer', passwordHash },
      ])
      .onConflictDoNothing()
      .returning({ id: users.id });

    const newEvents = await tx
      .insert(events)
      .values([
        {
          id: ids.meetup,
          organizerId: ids.alice,
          title: 'Baghdad Node.js Meetup',
          description: 'Lightning talks on Node.js in production, then pizza.',
          venue: 'Baghdad Tech Hub, Karrada',
          startsAt: daysFromNow(14, 16),
          endsAt: daysFromNow(14, 19),
          capacity: 120,
          status: 'published',
        },
        {
          id: ids.workshop,
          organizerId: ids.alice,
          title: 'TypeScript Workshop',
          description: 'A hands-on afternoon of strict TypeScript. Bring a laptop.',
          venue: 'Room 2, Baghdad Tech Hub',
          startsAt: daysFromNow(21, 13),
          endsAt: daysFromNow(21, 17),
          capacity: 3,
          // Matches the two confirmed bookings below: one seat left.
          seatsBooked: 2,
          status: 'published',
        },
        {
          id: ids.postgres,
          organizerId: ids.bob,
          title: 'Intro to PostgreSQL',
          description: 'Tables, indexes and transactions, explained from scratch.',
          venue: 'Online',
          startsAt: daysFromNow(30, 17),
          endsAt: daysFromNow(30, 19),
          capacity: 40,
          seatsBooked: 1,
          status: 'published',
        },
        {
          id: ids.docker,
          organizerId: ids.bob,
          title: 'Docker for Beginners',
          description: 'Still being planned, so only Bob can see it.',
          venue: 'To be decided',
          startsAt: daysFromNow(45, 15),
          endsAt: daysFromNow(45, 18),
          capacity: 25,
          status: 'draft',
        },
        {
          id: ids.gameNight,
          organizerId: ids.alice,
          title: 'Game Dev Night',
          description: 'Cancelled: the venue fell through.',
          venue: 'Baghdad Tech Hub, Karrada',
          startsAt: daysFromNow(10, 17),
          endsAt: daysFromNow(10, 21),
          capacity: 50,
          status: 'cancelled',
        },
      ])
      .onConflictDoNothing()
      .returning({ id: events.id });

    const newBookings = await tx
      .insert(bookings)
      .values([
        { id: ids.bobAtWorkshop, eventId: ids.workshop, userId: ids.bob },
        { id: ids.adminAtWorkshop, eventId: ids.workshop, userId: ids.admin },
        { id: ids.aliceAtPostgres, eventId: ids.postgres, userId: ids.alice },
        // Bob's booking was cancelled together with the event, and stays as history.
        {
          id: ids.bobAtGameNight,
          eventId: ids.gameNight,
          userId: ids.bob,
          status: 'cancelled',
          cancelledAt: new Date(),
        },
      ])
      .onConflictDoNothing()
      .returning({ id: bookings.id });

    return { users: newUsers.length, events: newEvents.length, bookings: newBookings.length };
  });
}

// Runs only as a script (npm run db:seed), so tests can import seed() without side effects.
if (import.meta.main) {
  try {
    const added = await seed();
    const total = added.users + added.events + added.bookings;
    logger.info(
      `Seed added ${added.users} users, ${added.events} events and ${added.bookings} bookings` +
        (total === 0 ? ' (all were already there)' : ''),
    );
  } catch (error) {
    logger.fatal({ err: error }, 'Seeding failed');
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
