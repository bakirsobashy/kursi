import { z } from 'zod';

// Emails are compared and stored trimmed and lowercased; the database refuses anything else.
const email = z
  .string({ error: 'must be a string' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'must be a valid email address' }).max(254));

export const registerBody = z.object({
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
});

// Login doesn't repeat the length rules: a wrong password gets the same answer however long it is.
export const loginBody = z.object({
  email,
  password: z.string({ error: 'must be a string' }).min(1, 'must not be empty').max(128),
});

export type RegisterBody = z.infer<typeof registerBody>;
export type LoginBody = z.infer<typeof loginBody>;
