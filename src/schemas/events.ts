import { z } from 'zod';
import { eventStatus } from '../db/schema.js';
import { pageOf, timestamp } from './common.js';

// Accepts "2026-11-20T18:00:00Z" or "2026-11-20T18:00:00+03:00". Stored and returned in UTC.
const dateTime = z.iso
  .datetime({ offset: true, error: 'must be an ISO 8601 date-time with a time zone' })
  .transform((value) => new Date(value))
  .meta({ description: 'ISO 8601, with Z or an offset such as +03:00. Returned in UTC.' });

const inTheFuture = dateTime
  .refine((date) => date.getTime() > Date.now(), 'must be in the future')
  .meta({ description: 'ISO 8601, with Z or an offset such as +03:00. Must be in the future.' });

// The fields of an event, without cross-field rules: Zod can only make a partial copy of
// an object schema that has none.
const eventFields = z.object({
  title: z.string().trim().min(3, 'must be at least 3 characters').max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  venue: z.string().trim().min(1, 'must not be empty').max(200),
  startsAt: inTheFuture,
  endsAt: dateTime.meta({ description: 'ISO 8601, with Z or an offset. Must be after startsAt.' }),
  capacity: z
    .number({ error: 'must be a whole number' })
    .int('must be a whole number')
    .min(1, 'must be at least 1')
    .max(10_000, 'must be at most 10,000')
    .meta({ description: "Seats on offer. An update can't take it below the seats booked." }),
});

/** Checks that an event ends after it starts. Shared by create, and by update after merging. */
export const eventTimes = z
  .object({ startsAt: z.date(), endsAt: z.date() })
  .refine(({ startsAt, endsAt }) => endsAt > startsAt, {
    path: ['endsAt'],
    message: 'must be after startsAt',
  });

export const createEventBody = eventFields
  .superRefine((event, ctx) => {
    if (event.endsAt <= event.startsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'must be after startsAt' });
    }
  })
  .meta({ id: 'NewEvent' });

export const updateEventBody = eventFields
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'must change at least one field')
  .meta({
    id: 'EventChanges',
    description: 'Only the fields to change; at least one. Times are checked as they end up.',
  });

export const eventParams = z.object({
  id: z.uuid({ error: 'must be a UUID' }).meta({ description: 'The event ID.' }),
});

/** page and limit arrive as text in the query string, so they are coerced to numbers. */
export const pagination = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1, 'must be at least 1')
    .default(1)
    .meta({ description: 'Which page, from 1.' }),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'must be at least 1')
    .max(100, 'must be at most 100')
    .default(20)
    .meta({ description: 'Items per page.' }),
});

export const listEventsQuery = pagination
  .extend({
    from: dateTime
      .optional()
      .meta({ description: 'Only events that start at or after this time.' }),
    to: dateTime.optional().meta({ description: 'Only events that start at or before this time.' }),
    q: z
      .string()
      .trim()
      .min(1, 'must not be empty')
      .max(100)
      .optional()
      .meta({ description: 'Only events whose title contains this text, in any case.' }),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    path: ['to'],
    message: 'must not be before from',
  });

export const eventResponse = z
  .strictObject({
    id: z.uuid(),
    organizerId: z.uuid().meta({ description: 'The user who created the event.' }),
    title: z.string(),
    description: z.string().nullable(),
    venue: z.string(),
    startsAt: timestamp,
    endsAt: timestamp,
    capacity: z.int().min(1),
    seatsBooked: z.int().min(0).meta({ description: 'Confirmed bookings.' }),
    seatsLeft: z.int().min(0).meta({ description: 'capacity minus seatsBooked.' }),
    status: z.enum(eventStatus.enumValues).meta({
      description:
        '`draft`: only its organizer and admins can see it. `published`: listed, and bookable until it starts. `cancelled`: its bookings were cancelled with it.',
    }),
    createdAt: timestamp,
  })
  .meta({ id: 'Event' });

export const eventListResponse = pageOf(eventResponse).meta({ id: 'EventList' });

export const attendee = z
  .strictObject({
    bookingId: z.uuid(),
    bookedAt: timestamp,
    user: z.strictObject({ id: z.uuid(), name: z.string(), email: z.email() }),
  })
  .meta({ id: 'Attendee', description: 'A confirmed booking, and who holds it.' });

export const attendeeListResponse = pageOf(attendee).meta({ id: 'AttendeeList' });

export type EventResponse = z.infer<typeof eventResponse>;
export type EventListResponse = z.infer<typeof eventListResponse>;
export type AttendeeListResponse = z.infer<typeof attendeeListResponse>;
export type CreateEventBody = z.infer<typeof createEventBody>;
export type UpdateEventBody = z.infer<typeof updateEventBody>;
export type Pagination = z.infer<typeof pagination>;
export type ListEventsQuery = z.infer<typeof listEventsQuery>;
