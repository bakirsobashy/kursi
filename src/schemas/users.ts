import { z } from 'zod';
import { userRole } from '../db/schema.js';
import { timestamp } from './common.js';

export const userResponse = z
  .strictObject({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: z.enum(userRole.enumValues).meta({
      description: '`admin` can manage every event; `user` only the events they organize.',
    }),
    createdAt: timestamp,
  })
  .meta({ id: 'User', description: 'An account, as its owner sees it.' });

export type UserResponse = z.infer<typeof userResponse>;
