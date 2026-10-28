import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db } from '../db/client.js';
import { refreshTokens, users } from '../db/schema.js';
import type { AuthUser } from '../lib/tokens.js';

/*
 * Refresh tokens keep a session alive after the 15-minute access token expires.
 *
 * - Each one is 256 random bits, sent to the browser in a cookie. Only its SHA-256 hash is
 *   stored, so a leaked database doesn't hand out working sessions. A fast hash is safe here
 *   because, unlike a password, the token can't be guessed.
 * - Every login starts a new "family". Each refresh revokes the token it was given and issues
 *   the next one in the same family, so a token works exactly once.
 * - A revoked token that comes back means someone kept a copy: the thief or the real user is
 *   replaying it. We can't tell which, so the whole family is revoked and both must log in again.
 */

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// 32 random bytes in base64url are always 43 characters from this alphabet.
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

/** Creates a refresh token, in a new family unless one is given, and returns the raw token. */
export async function issueRefreshToken(
  userId: string,
  familyId: string = randomUUID(),
  executor: Executor = db,
) {
  const token = randomBytes(32).toString('base64url');
  await executor.insert(refreshTokens).values({
    userId,
    familyId,
    tokenHash: hashToken(token),
    // Each refresh restarts the clock, so a session ends after 7 days without any activity.
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_SECONDS * 1000),
  });
  return token;
}

/**
 * Revokes every still-valid token in a family, ending that session on every tab.
 * Returns how many tokens it revoked: 0 means the session had already ended.
 */
export async function revokeFamily(familyId: string, executor: Executor = db) {
  const revoked = await executor
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return revoked.length;
}

export type RotationResult =
  | { status: 'rotated'; user: AuthUser; refreshToken: string }
  | { status: 'reused'; userId: string; familyId: string }
  | { status: 'ended' }
  | { status: 'expired' }
  | { status: 'unknown' };

/**
 * Swaps a refresh token for the next one in its family, in one transaction.
 * `SELECT … FOR UPDATE` locks the token's row, so two requests presenting the same token
 * run one after the other: the second one finds it already revoked.
 */
export async function rotateRefreshToken(token: string): Promise<RotationResult> {
  if (!TOKEN_FORMAT.test(token)) return { status: 'unknown' };

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: refreshTokens.id,
        familyId: refreshTokens.familyId,
        expiresAt: refreshTokens.expiresAt,
        revokedAt: refreshTokens.revokedAt,
        userId: users.id,
        role: users.role,
      })
      .from(refreshTokens)
      .innerJoin(users, eq(users.id, refreshTokens.userId))
      .where(eq(refreshTokens.tokenHash, hashToken(token)))
      .for('update', { of: refreshTokens });

    if (!row) return { status: 'unknown' };

    if (row.revokedAt) {
      // A used token while its session is still alive means a copy is being replayed: end the
      // session. This commits with the transaction, so it sticks even though the request fails.
      // If nothing was left to revoke, the session had already ended (by logout or an earlier
      // replay), so there's nothing to protect and nothing to report.
      const revoked = await revokeFamily(row.familyId, tx);
      return revoked > 0
        ? { status: 'reused', userId: row.userId, familyId: row.familyId }
        : { status: 'ended' };
    }

    if (row.expiresAt <= new Date()) return { status: 'expired' };

    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, row.id));
    const refreshToken = await issueRefreshToken(row.userId, row.familyId, tx);

    // The role is read fresh from the users table, so a role change applies at the next refresh.
    return { status: 'rotated', user: { id: row.userId, role: row.role }, refreshToken };
  });
}

/** Ends the session the token belongs to. Unknown tokens are ignored. */
export async function revokeSessionOf(token: string) {
  if (!TOKEN_FORMAT.test(token)) return;
  const [row] = await db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, hashToken(token)));
  if (row) await revokeFamily(row.familyId);
}
