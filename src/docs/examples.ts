import { DEMO_EMAILS, DEMO_IDS, DEMO_PASSWORD } from '../db/demo.js';
import type { LoginBody, RegisterBody, TokenResponse } from '../schemas/auth.js';
import type { BookingResponse } from '../schemas/bookings.js';
import type { AttendeeListResponse, EventResponse } from '../schemas/events.js';
import type { UserResponse } from '../schemas/users.js';

/*
 * The examples in the API docs. They use the demo rows from src/db/seed.ts, so on a seeded
 * database the pre-filled "Try it out" requests work as they are. Each is typed by its schema,
 * and tests/openapi.test.ts parses every one, so an example can't drift from what it shows.
 */

/** A time `days` from now, on the hour, in UTC, so request examples stay in the future. */
function daysFromNow(days: number, hourUtc: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Shaped like a real access token, so it passes the schema, but it is signed with nothing. */
const sampleAccessToken = [
  base64url({ alg: 'HS256', typ: 'JWT' }),
  base64url({ role: 'user', sub: DEMO_IDS.alice, iss: 'kursi', aud: 'kursi-api' }),
  'not-a-real-signature',
].join('.');

export const loginExamples = {
  alice: {
    summary: 'Alice, who organizes the workshop and holds a booking',
    value: { email: DEMO_EMAILS.alice, password: DEMO_PASSWORD },
  },
  bob: {
    summary: 'Bob, who organizes the PostgreSQL intro and a draft',
    value: { email: DEMO_EMAILS.bob, password: DEMO_PASSWORD },
  },
  admin: {
    summary: 'The admin, who can manage every event',
    value: { email: DEMO_EMAILS.admin, password: DEMO_PASSWORD },
  },
} satisfies Record<string, { summary: string; value: LoginBody }>;

export const registerExample = {
  email: 'sara@example.com',
  password: 'a-long-password',
  name: 'Sara Ahmed',
} satisfies RegisterBody;

/** Request bodies carry times as text, before the schema turns them into dates. */
export const newEventExample = {
  title: 'Intro to Express 5',
  description: 'Routing, async errors and middleware, with live coding.',
  venue: 'Baghdad Tech Hub, Karrada',
  startsAt: daysFromNow(40, 15),
  endsAt: daysFromNow(40, 17),
  capacity: 60,
};

export const eventChangesExample = {
  venue: 'Room 3, Baghdad Tech Hub',
  capacity: 10,
};

export const tokenExample = {
  accessToken: sampleAccessToken,
  tokenType: 'Bearer',
  expiresIn: 900,
} satisfies TokenResponse;

export const userExample = {
  id: DEMO_IDS.alice,
  email: DEMO_EMAILS.alice,
  name: 'Alice Organizer',
  role: 'user',
  createdAt: '2026-10-01T09:00:00.000Z',
} satisfies UserResponse;

export const eventExample = {
  id: DEMO_IDS.workshop,
  organizerId: DEMO_IDS.alice,
  title: 'TypeScript Workshop',
  description: 'A hands-on afternoon of strict TypeScript. Bring a laptop.',
  venue: 'Room 2, Baghdad Tech Hub',
  startsAt: '2026-11-18T13:00:00.000Z',
  endsAt: '2026-11-18T17:00:00.000Z',
  capacity: 3,
  seatsBooked: 2,
  seatsLeft: 1,
  status: 'published',
  createdAt: '2026-10-01T09:00:00.000Z',
} satisfies EventResponse;

export const bookingExample = {
  id: DEMO_IDS.aliceAtPostgres,
  status: 'confirmed',
  createdAt: '2026-10-01T09:00:00.000Z',
  cancelledAt: null,
  event: {
    id: DEMO_IDS.postgres,
    title: 'Intro to PostgreSQL',
    venue: 'Online',
    startsAt: '2026-11-27T17:00:00.000Z',
    endsAt: '2026-11-27T19:00:00.000Z',
    status: 'published',
  },
} satisfies BookingResponse;

export const attendeeListExample = {
  data: [
    {
      bookingId: DEMO_IDS.bobAtWorkshop,
      bookedAt: '2026-10-01T09:00:00.000Z',
      user: { id: DEMO_IDS.bob, name: 'Bob Organizer', email: DEMO_EMAILS.bob },
    },
    {
      bookingId: DEMO_IDS.adminAtWorkshop,
      bookedAt: '2026-10-01T09:00:00.000Z',
      user: { id: DEMO_IDS.admin, name: 'Kursi Admin', email: DEMO_EMAILS.admin },
    },
  ],
  meta: { page: 1, limit: 20, total: 2 },
} satisfies AttendeeListResponse;

const page = (total: number) => ({ page: 1, limit: 20, total });

export const eventListExample = { data: [eventExample], meta: page(1) };
export const bookingListExample = { data: [bookingExample], meta: page(1) };
