import { z } from 'zod';
import { bookingStatus, eventStatus } from '../db/schema.js';
import { pageOf, timestamp } from './common.js';

export const bookingParams = z.object({
  id: z.uuid({ error: 'must be a UUID' }).meta({ description: 'The booking ID.' }),
});

export const bookingResponse = z
  .strictObject({
    id: z.uuid(),
    status: z.enum(bookingStatus.enumValues),
    createdAt: timestamp,
    cancelledAt: timestamp.nullable().meta({ description: 'null while the booking is confirmed.' }),
    event: z
      .strictObject({
        id: z.uuid(),
        title: z.string(),
        venue: z.string(),
        startsAt: timestamp,
        endsAt: timestamp,
        status: z.enum(eventStatus.enumValues),
      })
      .meta({ description: 'The event the seat is at, as it is now.' }),
  })
  .meta({ id: 'Booking', description: 'One seat at an event, held by the caller.' });

export const bookingListResponse = pageOf(bookingResponse).meta({ id: 'BookingList' });

export type BookingResponse = z.infer<typeof bookingResponse>;
export type BookingListResponse = z.infer<typeof bookingListResponse>;
