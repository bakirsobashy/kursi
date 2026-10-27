import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * The database enforces the rules that must never break, whatever the application code does:
 * no event sells more seats than it has, and nobody holds two confirmed seats at one event.
 */

export const userRole = pgEnum('user_role', ['user', 'admin']);
export const eventStatus = pgEnum('event_status', ['draft', 'published', 'cancelled']);
export const bookingStatus = pgEnum('booking_status', ['confirmed', 'cancelled']);

// Postgres 18 generates UUIDv7 itself: IDs sort by creation time, which keeps indexes compact.
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    role: userRole('role').notNull().default('user'),
    createdAt: createdAt(),
  },
  (t) => [
    // The app lowercases emails; this makes "Ali@x.io" and "ali@x.io" impossible to store twice.
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);

export const events = pgTable(
  'events',
  {
    id: id(),
    organizerId: uuid('organizer_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    venue: text('venue').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    seatsBooked: integer('seats_booked').notNull().default(0),
    status: eventStatus('status').notNull().default('draft'),
    createdAt: createdAt(),
  },
  (t) => [
    check('events_capacity_positive', sql`${t.capacity} > 0`),
    check('events_seats_within_capacity', sql`${t.seatsBooked} BETWEEN 0 AND ${t.capacity}`),
    check('events_ends_after_starts', sql`${t.endsAt} > ${t.startsAt}`),
    // Serves the public list: published events, soonest first.
    index('events_status_starts_at_idx').on(t.status, t.startsAt),
  ],
);

export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    status: bookingStatus('status').notNull().default('confirmed'),
    createdAt: createdAt(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (t) => [
    // One active booking per user per event; cancelled rows stay as history.
    // It also serves lookups of an event's confirmed bookings by event_id.
    uniqueIndex('bookings_one_confirmed_per_user_idx')
      .on(t.eventId, t.userId)
      .where(sql`${t.status} = 'confirmed'`),
    check(
      'bookings_cancelled_at_matches_status',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL)`,
    ),
    // Serves "my bookings".
    index('bookings_user_id_idx').on(t.userId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Only a SHA-256 hash of the token is stored, never the token itself.
    tokenHash: text('token_hash').notNull().unique(),
    // One family per login; reusing a revoked token revokes the whole family.
    familyId: uuid('family_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_family_id_idx').on(t.familyId)],
);

export type User = typeof users.$inferSelect;
export type Event = typeof events.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
