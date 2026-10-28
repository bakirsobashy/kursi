import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { eq } from 'drizzle-orm';
import { decodeJwt } from 'jose';
import type { Response } from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../src/db/client.js';
import { refreshTokens, users, type User } from '../src/db/schema.js';
import { refreshCookieOptions } from '../src/lib/refresh-cookie.js';
import { api, bearer, createUser, resetDb, TEST_PASSWORD } from './helpers.js';

/** The refresh_token Set-Cookie line of a response, if it has one. */
const refreshSetCookie = (res: Response) =>
  ([] as string[])
    .concat(res.headers['set-cookie'] ?? [])
    .find((c) => c.startsWith('refresh_token='));

/** The raw refresh token a response put in the cookie. */
function refreshTokenFrom(res: Response) {
  const value = refreshSetCookie(res)?.split(';')[0]?.slice('refresh_token='.length);
  if (!value) throw new Error(`No refresh cookie in the response (status ${res.status})`);
  return value;
}

const logIn = async (user: User) => {
  const res = await api()
    .post('/api/v1/auth/login')
    .send({ email: user.email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return refreshTokenFrom(res);
};

const refreshWith = (token: string) =>
  api().post('/api/v1/auth/refresh').set('Cookie', `refresh_token=${token}`);

const logOutWith = (token: string) =>
  api().post('/api/v1/auth/logout').set('Cookie', `refresh_token=${token}`);

let user: User;

beforeEach(async () => {
  await resetDb();
  user = await createUser();
});

describe('the refresh cookie', () => {
  it('is set at login as HttpOnly, SameSite=Strict, scoped to /api/v1/auth, for 7 days', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    const cookie = refreshSetCookie(res);
    expect(cookie).toMatch(/^refresh_token=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).toContain('Path=/api/v1/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    // Tests run with NODE_ENV=test; Secure is added in production (next test).
    expect(cookie).not.toContain('Secure');
  });

  it('is Secure in production', () => {
    expect(refreshCookieOptions(true)).toMatchObject({
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
    });
    expect(refreshCookieOptions(false).secure).toBe(false);
  });

  it('is never sent back in a response body', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(JSON.stringify(res.body)).not.toContain(refreshTokenFrom(res));
  });
});

describe('what the database stores', () => {
  it('keeps only a SHA-256 hash of the token, never the token', async () => {
    const token = await logIn(user);

    const rows = await db.select().from(refreshTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(createHash('sha256').update(token).digest('base64url'));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('starts a new family at every login', async () => {
    await logIn(user);
    await logIn(user);

    const rows = await db.select().from(refreshTokens);
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(2);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('returns a new access token and a different refresh cookie', async () => {
    const first = await logIn(user);

    const res = await refreshWith(first);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    expect(decodeJwt(res.body.accessToken).sub).toBe(user.id);
    expect(refreshTokenFrom(res)).not.toBe(first);
    const me = await api()
      .get('/api/v1/users/me')
      .set('Authorization', bearer(res.body.accessToken));
    expect(me.status).toBe(200);
  });

  it('keeps working along a chain: A gives B, B gives C', async () => {
    const a = await logIn(user);
    const b = refreshTokenFrom(await refreshWith(a));

    const res = await refreshWith(b);

    expect(res.status).toBe(200);
    const rows = await db.select().from(refreshTokens);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.familyId)).size).toBe(1);
    expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
  });

  it('detects a replayed token: once A has given B, presenting A again also disables B', async () => {
    const a = await logIn(user);
    const b = refreshTokenFrom(await refreshWith(a));

    const replay = await refreshWith(a);
    const afterReplay = await refreshWith(b);

    expect(replay.status).toBe(401);
    expect(replay.body).toMatchObject({
      type: expect.stringMatching(/#invalid-refresh-token$/),
      detail: expect.stringContaining('already used'),
    });
    expect(afterReplay.status).toBe(401);
    expect(afterReplay.body.detail).toBe('The session has ended. Log in again.');
    const live = await db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.id));
    expect(live.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('leaves the user’s other sessions alone when one session is revoked', async () => {
    const laptop = await logIn(user);
    const phone = await logIn(user);
    const laptopNext = refreshTokenFrom(await refreshWith(laptop));
    await refreshWith(laptop); // replayed: ends the laptop session only

    expect((await refreshWith(laptopNext)).status).toBe(401);
    expect((await refreshWith(phone)).status).toBe(200);
  });

  it('returns 401 for an expired refresh token', async () => {
    const token = await logIn(user);
    await db.update(refreshTokens).set({ expiresAt: new Date(Date.now() - 1000) });

    const res = await refreshWith(token);

    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('The session has expired. Log in again.');
  });

  it.each([
    ['no cookie', undefined],
    ['an unknown token', 'A'.repeat(43)],
    ['a malformed token', 'not-a-token'],
  ])('returns 401 for %s', async (_case, token) => {
    const request = api().post('/api/v1/auth/refresh');
    const res = await (token ? request.set('Cookie', `refresh_token=${token}`) : request);

    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/#invalid-refresh-token$/);
  });

  it('deletes the cookie when a refresh fails', async () => {
    const res = await refreshWith('A'.repeat(43));

    expect(refreshSetCookie(res)).toMatch(
      /^refresh_token=;.*Path=\/api\/v1\/auth.*Expires=Thu, 01 Jan 1970/,
    );
  });

  it('returns 401 once the account is deleted', async () => {
    const token = await logIn(user);
    await db.delete(users).where(eq(users.id, user.id));

    expect((await refreshWith(token)).status).toBe(401);
  });

  it("puts the user's current role in the new access token", async () => {
    const token = await logIn(user);
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));

    const res = await refreshWith(token);

    expect(decodeJwt(res.body.accessToken).role).toBe('admin');
  });

  it('waits for a refresh already in progress, then sees its token as used', async () => {
    const token = await logIn(user);
    const tokenHash = createHash('sha256').update(token).digest('base64url');

    // Play the part of another refresh, halfway through: it has locked the row and revoked
    // the token, but hasn't committed yet.
    const other = await pool.connect();
    try {
      await other.query('BEGIN');
      await other.query('SELECT 1 FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [
        tokenHash,
      ]);
      await other.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [
        tokenHash,
      ]);

      const pending = refreshWith(token).then((res) => res);
      await waitUntilARequestIsBlocked();
      await other.query('COMMIT');

      // With the row lock, this request waited and then read the committed, revoked row.
      // Without it, it would have read the old row and handed out a second valid token.
      expect((await pending).status).toBe(401);
    } finally {
      other.release();
    }
  });

  it('known trade-off: two tabs refreshing with the same token end the session', async () => {
    const token = await logIn(user);

    const results = await Promise.all([refreshWith(token), refreshWith(token)]);
    const winner = results.find((res) => res.status === 200)!;

    // One rotates the token; the other then presents a used token, which looks like a replay.
    expect(results.map((res) => res.status).sort()).toEqual([200, 401]);
    expect((await refreshWith(refreshTokenFrom(winner))).status).toBe(401);
  });
});

/** Waits until some query in the test database is waiting on a row lock. */
async function waitUntilARequestIsBlocked() {
  for (let attempt = 0; attempt < 100; attempt++) {
    const { rows } = await pool.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (rows[0]!.waiting > 0) return;
    await sleep(20);
  }
  throw new Error('No query ever waited on the lock');
}

describe('POST /api/v1/auth/logout', () => {
  it('ends the session and deletes the cookie', async () => {
    const token = await logIn(user);

    const res = await logOutWith(token);

    expect(res.status).toBe(204);
    expect(refreshSetCookie(res)).toMatch(/^refresh_token=;.*Expires=Thu, 01 Jan 1970/);
    // A logged-out token is just an ended session, not a stolen token being replayed.
    const after = await refreshWith(token);
    expect(after.status).toBe(401);
    expect(after.body.detail).toBe('The session has ended. Log in again.');
  });

  it('ends the whole session, including tokens issued after the one presented', async () => {
    const a = await logIn(user);
    const b = refreshTokenFrom(await refreshWith(a));

    await logOutWith(a);

    expect((await refreshWith(b)).status).toBe(401);
  });

  it('returns 204 without a cookie, so logging out twice is harmless', async () => {
    const res = await api().post('/api/v1/auth/logout');

    expect(res.status).toBe(204);
  });
});
