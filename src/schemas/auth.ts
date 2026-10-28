import { z } from 'zod';

// Emails are compared and stored trimmed and lowercased; the database refuses anything else.
const email = z
  .string({ error: 'must be a string' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'must be a valid email address' }).max(254))
  // The docs show a schema's input side, which for a pipe is the plain string before it.
  .meta({
    description: 'Trimmed and lowercased before use.',
    override: { format: 'email', maxLength: 254 },
  });

export const registerBody = z
  .object({
    email,
    // Passwords are never trimmed: a space at either end is part of the password.
    password: z
      .string({ error: 'must be a string' })
      .min(10, 'must be at least 10 characters')
      .max(128, 'must be at most 128 characters'),
    name: z
      .string({ error: 'must be a string' })
      .trim()
      .min(1, 'must not be empty')
      .max(100, 'must be at most 100 characters'),
  })
  .meta({ id: 'NewAccount' });

// Login doesn't repeat the length rules: a wrong password gets the same answer however long it is.
export const loginBody = z
  .object({
    email,
    password: z.string({ error: 'must be a string' }).min(1, 'must not be empty').max(128),
  })
  .meta({ id: 'Login' });

export const tokenResponse = z
  .strictObject({
    accessToken: z.jwt().meta({ description: 'Send it as `Authorization: Bearer <accessToken>`.' }),
    tokenType: z.literal('Bearer'),
    expiresIn: z.int().positive().meta({ description: 'Seconds until the access token expires.' }),
  })
  .meta({ id: 'AccessToken' });

export type RegisterBody = z.infer<typeof registerBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type TokenResponse = z.infer<typeof tokenResponse>;
