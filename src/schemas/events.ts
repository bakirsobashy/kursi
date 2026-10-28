import { z } from 'zod';

// Accepts "2026-11-20T18:00:00Z" or "2026-11-20T18:00:00+03:00". Stored and returned in UTC.
const dateTime = z.iso
  .datetime({ offset: true, error: 'must be an ISO 8601 date-time with a time zone' })
  .transform((value) => new Date(value));

const inTheFuture = dateTime.refine((date) => date.getTime() > Date.now(), 'must be in the future');

// The fields of an event, without cross-field rules: Zod can only make a partial copy of
// an object schema that has none.
const eventFields = z.object({
  title: z.string().trim().min(3, 'must be at least 3 characters').max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  venue: z.string().trim().min(1, 'must not be empty').max(200),
  startsAt: inTheFuture,
  endsAt: dateTime,
  capacity: z
    .number({ error: 'must be a whole number' })
    .int('must be a whole number')
    .min(1, 'must be at least 1')
    .max(10_000, 'must be at most 10,000'),
});

/** Checks that an event ends after it starts. Shared by create, and by update after merging. */
export const eventTimes = z
  .object({ startsAt: z.date(), endsAt: z.date() })
  .refine(({ startsAt, endsAt }) => endsAt > startsAt, {
    path: ['endsAt'],
    message: 'must be after startsAt',
  });

export const createEventBody = eventFields.superRefine((event, ctx) => {
  if (event.endsAt <= event.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'must be after startsAt' });
  }
});

export const updateEventBody = eventFields
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'must change at least one field');

export const eventParams = z.object({ id: z.uuid({ error: 'must be a UUID' }) });

/** page and limit arrive as text in the query string, so they are coerced to numbers. */
export const pagination = z.object({
  page: z.coerce.number().int().min(1, 'must be at least 1').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'must be at least 1')
    .max(100, 'must be at most 100')
    .default(20),
});

export const listEventsQuery = pagination
  .extend({
    from: dateTime.optional(),
    to: dateTime.optional(),
    q: z.string().trim().min(1, 'must not be empty').max(100).optional(),
  })
  .refine(({ from, to }) => !from || !to || from <= to, {
    path: ['to'],
    message: 'must not be before from',
  });

export type CreateEventBody = z.infer<typeof createEventBody>;
export type UpdateEventBody = z.infer<typeof updateEventBody>;
export type Pagination = z.infer<typeof pagination>;
export type ListEventsQuery = z.infer<typeof listEventsQuery>;
