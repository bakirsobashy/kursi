import argon2 from 'argon2';
import { logger } from '../lib/logger.js';
import { closeDb, db } from './client.js';
import { bookings, events, users } from './schema.js';

/*
 * Demo data for local development and the Swagger "Try it out" buttons.
 * Every row has a fixed ID and is inserted with ON CONFLICT DO NOTHING,
 * so running the seed twice changes nothing.
 */

export const DEMO_PASSWORD = 'demo-password';

const ids = {
  admin: '0199a3c2-0000-7000-8000-000000000001',
  alice: '0199a3c2-0000-7000-8000-000000000002',
  bob: '0199a3c2-0000-7000-8000-000000000003',
  meetup: '0199a3c2-0000-7000-8000-000000000101',
  workshop: '0199a3c2-0000-7000-8000-000000000102',
  postgres: '0199a3c2-0000-7000-8000-000000000103',
  docker: '0199a3c2-0000-7000-8000-000000000104',
  gameNight: '0199a3c2-0000-7000-8000-000000000105',
  bobAtWorkshop: '0199a3c2-0000-7000-8000-000000000201',
  adminAtWorkshop: '0199a3c2-0000-7000-8000-000000000202',
  aliceAtPostgres: '0199a3c2-0000-7000-8000-000000000203',
  bobAtGameNight: '0199a3c2-0000-7000-8000-000000000204',
} as const;

/** A time `days` from now, on the hour, in UTC. Relative dates keep the demo events upcoming. */
function daysFromNow(days: number, hourUtc: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date;
}

async function seed() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  await db.transaction(async (tx) => {
    const newUsers = await tx
      .insert(users)
      .values([
        {
          id: ids.admin,
          email: 'admin@kursi.test',
          name: 'Kursi Admin',
          role: 'admin',
          passwordHash,
        },
        { id: ids.alice, email: 'alice@kursi.test', name: 'Alice Organizer', passwordHash },
        { id: ids.bob, email: 'bob@kursi.test', name: 'Bob Organizer', passwordHash },
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

    logger.info(
      `Seed added ${newUsers.length} users, ${newEvents.length} events and ${newBookings.length} bookings` +
        (newUsers.length + newEvents.length + newBookings.length === 0
          ? ' (all were already there)'
          : ''),
    );
  });
}

try {
  await seed();
} catch (error) {
  logger.fatal({ err: error }, 'Seeding failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
