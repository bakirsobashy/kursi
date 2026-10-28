import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/client.js';
import { users } from '../src/db/schema.js';
import { api, createUser, resetDb, TEST_PASSWORD } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/v1/auth/register', () => {
  const newAccount = { email: 'Ali@Kursi.test ', password: 'a-long-password', name: ' Ali ' };

  it('creates the account and returns it without the password hash', async () => {
    const res = await api().post('/api/v1/auth/register').send(newAccount);

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe('/api/v1/users/me');
    expect(res.body).toEqual({
      id: expect.stringMatching(UUID),
      email: 'ali@kursi.test',
      name: 'Ali',
      role: 'user',
      createdAt: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(/password|argon2/i);
  });

  it('stores an Argon2id hash, never the password itself', async () => {
    await api().post('/api/v1/auth/register').send(newAccount);

    const [row] = await db.select().from(users).where(eq(users.email, 'ali@kursi.test'));
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row?.passwordHash).not.toContain(newAccount.password);
    expect(await argon2.verify(row!.passwordHash, newAccount.password)).toBe(true);
  });

  it('ignores a role sent in the body, so nobody can register as an admin', async () => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ ...newAccount, role: 'admin' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('user');
  });

  it('returns 409 for an email that is already registered, in any letter case', async () => {
    await createUser({ email: 'ali@kursi.test' });

    const res = await api().post('/api/v1/auth/register').send(newAccount);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ type: expect.stringMatching(/#email-taken$/), status: 409 });
  });

  it.each([
    ['a password under 10 characters', { password: 'too-short' }, 'password'],
    ['a password over 128 characters', { password: 'x'.repeat(129) }, 'password'],
    ['an invalid email', { email: 'not-an-email' }, 'email'],
    ['an empty name', { name: '   ' }, 'name'],
    ['a missing name', { name: undefined }, 'name'],
  ])('returns 400 for %s', async (_case, change, field) => {
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ ...newAccount, ...change });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: field, message: expect.any(String) }]);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns a 15-minute access token for the right email and password', async () => {
    const user = await createUser({ email: 'ali@kursi.test', role: 'admin' });

    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ali@kursi.test', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accessToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
    });
    const claims = decodeJwt(res.body.accessToken);
    expect(decodeProtectedHeader(res.body.accessToken).alg).toBe('HS256');
    expect(claims).toMatchObject({ sub: user.id, role: 'admin', iss: 'kursi', aud: 'kursi-api' });
    expect(claims.exp! - claims.iat!).toBe(900);
  });

  it('matches the email without regard to case or surrounding spaces', async () => {
    await createUser({ email: 'ali@kursi.test' });

    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: '  ALI@kursi.TEST', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
  });

  it('returns 401 for a wrong password', async () => {
    await createUser({ email: 'ali@kursi.test' });

    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ali@kursi.test', password: 'not-the-password' });

    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer realm="kursi"');
    expect(res.body).toMatchObject({
      type: expect.stringMatching(/#invalid-credentials$/),
      title: 'Invalid email or password',
    });
  });

  it('answers an unknown email exactly like a wrong password', async () => {
    await createUser({ email: 'ali@kursi.test' });
    // Each response has its own request ID; everything else must match.
    const withoutRequestId = (body: Record<string, unknown>) => ({ ...body, requestId: 'any' });

    const wrongPassword = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ali@kursi.test', password: 'not-the-password' });
    const unknownEmail = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@kursi.test', password: 'not-the-password' });

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.headers['www-authenticate']).toBe(
      wrongPassword.headers['www-authenticate'],
    );
    expect(withoutRequestId(unknownEmail.body)).toEqual(withoutRequestId(wrongPassword.body));
  });

  it('still runs an Argon2 check for an unknown email, so timing reveals nothing', async () => {
    const verify = vi.spyOn(argon2, 'verify');

    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@kursi.test', password: 'not-the-password' });

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when the email or password is missing', async () => {
    const res = await api().post('/api/v1/auth/login').send({ email: 'ali@kursi.test' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: 'password', message: expect.any(String) }]);
  });
});
