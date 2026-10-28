import express from 'express';
import { eq } from 'drizzle-orm';
import { SignJWT, UnsecuredJWT } from 'jose';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { authenticate, requireRole } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { requestLogger } from '../src/middleware/request-logger.js';
import { api, bearer, createUser, loginAs, resetDb } from './helpers.js';

const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);

/** A token like the real ones, with any part changed, to check that each change is refused. */
function forgeToken({
  sub = '0199a3c2-0000-7000-8000-000000000001',
  role = 'user',
  alg = 'HS256',
  key = secret,
  issuer = 'kursi',
  audience = 'kursi-api',
  expiresAt = '15m' as string | number,
} = {}) {
  return new SignJWT({ role })
    .setProtectedHeader({ alg })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key);
}

beforeEach(async () => {
  await resetDb();
});

describe('GET /api/v1/users/me', () => {
  it('returns the logged-in user without the password hash', async () => {
    const user = await createUser({ email: 'ali@kursi.test', name: 'Ali' });

    const res = await api()
      .get('/api/v1/users/me')
      .set('Authorization', bearer(await loginAs(user)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: user.id,
      email: 'ali@kursi.test',
      name: 'Ali',
      role: 'user',
      createdAt: user.createdAt.toISOString(),
    });
  });

  it('works with a token from the real login endpoint', async () => {
    await createUser({ email: 'ali@kursi.test' });
    const login = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ali@kursi.test', password: 'correct-horse-battery' });

    const res = await api()
      .get('/api/v1/users/me')
      .set('Authorization', bearer(login.body.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('ali@kursi.test');
  });

  it('returns 401 with a WWW-Authenticate header when there is no token', async () => {
    const res = await api().get('/api/v1/users/me');

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer realm="kursi"');
    expect(res.body.type).toMatch(/#unauthorized$/);
  });

  it.each(['Token abc', 'Bearer', 'Bearer two words', 'bearer'])(
    'returns 401 for the malformed header "%s"',
    async (header) => {
      const res = await api().get('/api/v1/users/me').set('Authorization', header);

      expect(res.status).toBe(401);
    },
  );

  it('returns 401 for an expired token, and says it expired', async () => {
    const user = await createUser();
    const expired = await forgeToken({
      sub: user.id,
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    });

    const res = await api().get('/api/v1/users/me').set('Authorization', bearer(expired));

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      type: expect.stringMatching(/#invalid-token$/),
      detail: 'The access token has expired. Refresh it or log in again.',
    });
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('returns 401 for a token whose payload was edited', async () => {
    const user = await createUser();
    const [header, , signature] = (await loginAs(user)).split('.');
    const adminPayload = Buffer.from(
      JSON.stringify({ sub: user.id, role: 'admin', iss: 'kursi', aud: 'kursi-api' }),
    ).toString('base64url');

    const res = await api()
      .get('/api/v1/users/me')
      .set('Authorization', bearer(`${header}.${adminPayload}.${signature}`));

    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('The access token is not valid.');
  });

  it.each([
    ['signed with another secret', { key: new TextEncoder().encode('x'.repeat(40)) }],
    ['signed with HS512 instead of HS256', { alg: 'HS512' }],
    ['issued by someone else', { issuer: 'evil' }],
    ['meant for another API', { audience: 'other-api' }],
    ['carrying an unknown role', { role: 'superuser' }],
    ['whose subject is not a user ID', { sub: 'admin' }],
  ])('returns 401 for a token %s', async (_case, change) => {
    const user = await createUser();
    const token = await forgeToken({ sub: user.id, ...change });

    const res = await api().get('/api/v1/users/me').set('Authorization', bearer(token));

    expect(res.status).toBe(401);
    expect(res.body.type).toMatch(/#invalid-token$/);
  });

  it('returns 401 for an unsigned token ("alg": "none")', async () => {
    const user = await createUser();
    const unsigned = new UnsecuredJWT({ role: 'admin' })
      .setSubject(user.id)
      .setIssuer('kursi')
      .setAudience('kursi-api')
      .setIssuedAt()
      .setExpirationTime('15m')
      .encode();

    const res = await api().get('/api/v1/users/me').set('Authorization', bearer(unsigned));

    expect(res.status).toBe(401);
  });

  it('returns 401 once the account behind a valid token is deleted', async () => {
    const user = await createUser();
    const token = await loginAs(user);
    await db.delete(users).where(eq(users.id, user.id));

    const res = await api().get('/api/v1/users/me').set('Authorization', bearer(token));

    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('The account for this token no longer exists.');
  });
});

describe('requireRole', () => {
  const app = express();
  app.use(requestLogger);
  app.get('/admin-only', authenticate, requireRole('admin'), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);

  it('lets an admin through', async () => {
    const admin = await createUser({ role: 'admin' });

    const res = await request(app)
      .get('/admin-only')
      .set('Authorization', bearer(await loginAs(admin)));

    expect(res.status).toBe(200);
  });

  it('returns 403 for a logged-in user without the role', async () => {
    const user = await createUser();

    const res = await request(app)
      .get('/admin-only')
      .set('Authorization', bearer(await loginAs(user)));

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      type: expect.stringMatching(/#forbidden$/),
      detail: 'This needs the admin role.',
    });
  });

  it('returns 401, not 403, when there is no token at all', async () => {
    const res = await request(app).get('/admin-only');

    expect(res.status).toBe(401);
  });
});
