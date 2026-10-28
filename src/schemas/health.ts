import { z } from 'zod';

export const healthResponse = z.strictObject({ status: z.literal('ok') });
export const readyResponse = z.strictObject({ status: z.literal('ready') });

export type HealthResponse = z.infer<typeof healthResponse>;
export type ReadyResponse = z.infer<typeof readyResponse>;
