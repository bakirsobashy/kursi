import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { users } from '../db/schema.js';
import { AppError, ConflictError } from '../lib/errors.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../lib/passwords.js';
import { signAccessToken } from '../lib/tokens.js';
import type { LoginBody, RegisterBody } from '../schemas/auth.js';
import { findUserByEmail, toUserResponse } from './users.js';

/** Creates an account with the default role. Throws a 409 if the email is already registered. */
export async function register({ email, password, name }: RegisterBody) {
  const passwordHash = await hashPassword(password);
  try {
    const [user] = await db.insert(users).values({ email, passwordHash, name }).returning();
    return toUserResponse(user!);
  } catch (error) {
    // The unique index decides, so two sign-ups racing for one email can't both succeed.
    if (isUniqueViolation(error, 'users_email_unique')) {
      throw new ConflictError({
        slug: 'email-taken',
        title: 'Email already registered',
        detail: 'An account with this email already exists. Log in instead.',
      });
    }
    throw error;
  }
}

const invalidCredentials = () =>
  new AppError(401, {
    slug: 'invalid-credentials',
    title: 'Invalid email or password',
  });

/**
 * Returns an access token for a correct email and password. Every failure gets the same 401,
 * and an unknown email costs the same Argon2 work as a wrong password, so neither the response
 * nor its timing reveals whether an account exists.
 */
export async function login({ email, password }: LoginBody) {
  const user = await findUserByEmail(email);
  const valid = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyAgainstDummy(password);
  if (!user || !valid) throw invalidCredentials();

  return {
    accessToken: await signAccessToken({ id: user.id, role: user.role }),
    tokenType: 'Bearer' as const,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}
