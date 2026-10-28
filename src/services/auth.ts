import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { isUniqueViolation } from '../db/errors.js';
import { users } from '../db/schema.js';
import { AppError, ConflictError } from '../lib/errors.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../lib/passwords.js';
import type { Logger } from 'pino';
import { signAccessToken, type AuthUser } from '../lib/tokens.js';
import type { LoginBody, RegisterBody } from '../schemas/auth.js';
import { issueRefreshToken, revokeSessionOf, rotateRefreshToken } from './refresh-tokens.js';
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

/** The JSON body that login and refresh both return. */
async function accessTokenBody(user: AuthUser) {
  return {
    accessToken: await signAccessToken(user),
    tokenType: 'Bearer' as const,
    expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Returns an access token and a new session's refresh token for a correct email and password.
 * Every failure gets the same 401, and an unknown email costs the same Argon2 work as a wrong
 * password, so neither the response nor its timing reveals whether an account exists.
 */
export async function login({ email, password }: LoginBody) {
  const user = await findUserByEmail(email);
  const valid = user
    ? await verifyPassword(user.passwordHash, password)
    : await verifyAgainstDummy(password);
  if (!user || !valid) throw invalidCredentials();

  return {
    body: await accessTokenBody({ id: user.id, role: user.role }),
    refreshToken: await issueRefreshToken(user.id),
  };
}

const invalidRefreshToken = (detail: string) =>
  new AppError(401, { slug: 'invalid-refresh-token', title: 'Invalid refresh token', detail });

/**
 * Trades a refresh token for a new access token and the next refresh token.
 * A token that was already used ends the whole session, and the attempt is logged.
 */
export async function refresh(token: string | undefined, log: Logger) {
  if (!token) throw invalidRefreshToken('No refresh token was sent. Log in to start a session.');

  const result = await rotateRefreshToken(token);
  switch (result.status) {
    case 'rotated':
      return { body: await accessTokenBody(result.user), refreshToken: result.refreshToken };
    case 'reused':
      log.warn(
        { userId: result.userId, familyId: result.familyId },
        'A refresh token was used twice; the session was revoked',
      );
      throw invalidRefreshToken(
        'This refresh token was already used, so the session was ended to protect the account. Log in again.',
      );
    case 'ended':
      throw invalidRefreshToken('The session has ended. Log in again.');
    case 'expired':
      throw invalidRefreshToken('The session has expired. Log in again.');
    case 'unknown':
      throw invalidRefreshToken('The refresh token is not valid. Log in again.');
  }
}

/** Ends the session behind the token, if there is one. Logging out twice is fine. */
export async function logout(token: string | undefined) {
  if (token) await revokeSessionOf(token);
}
