import { z } from 'zod';

export const bookingParams = z.object({ id: z.uuid({ error: 'must be a UUID' }) });
