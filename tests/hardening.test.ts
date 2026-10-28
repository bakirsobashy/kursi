import { Writable } from 'node:stream';
import { eq, sql } from 'drizzle-orm';
import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { databaseProblem, pgErrorOf } from '../src/db/errors.js';
import { events, users } from '../src/db/schema.js';
import { REDACTED_PATHS } from '../src/lib/logger.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { PRODUCTION_RATE_LIMITS } from '../src/middleware/rate-limits.js';
import { requestLogger } from '../src/middleware/request-logger.js';
import { api, createEvent, createUser, resetDb, TEST_PASSWORD } from './helpers.js';

beforeEach(async () => {
  await resetDb();
});

describe('security headers', () => {
  it('sends helmet’s headers on every response', async () => {
    for (const path of ['/health', '/api/v1/events', '/nope']) {
      const res = await api().get(path);

      expect(res.headers['x-content-type-options'], path).toBe('nosniff');
      expect(res.headers['x-frame-options'], path).toBe('SAMEORIGIN');
      expect(res.headers['strict-transport-security'], path).toContain('max-age=');
      expect(res.headers['content-security-policy'], path).toContain("default-src 'self'");
      expect(res.headers['x-powered-by'], path).toBeUndefined();
    }
  });
});

describe('CORS', () => {
  const allowed = 'http://localhost:5173';

  it('allows a listed origin, with credentials, and exposes the useful headers', async () => {
    const res = await api().get('/api/v1/events').set('Origin', allowed);

    expect(res.headers['access-control-allow-origin']).toBe(allowed);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });

  it('sends no CORS headers to an unlisted origin, so its browser blocks the response', async () => {
    const res = await api().get('/api/v1/events').set('Origin', 'https://evil.example');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('answers a preflight from a listed origin, and only from a listed origin', async () => {
    const preflight = (origin: string) =>
      api()
        .options('/api/v1/events/0199a3c2-0000-7000-8000-000000000101')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'PATCH')
        .set('Access-Control-Request-Headers', 'authorization,content-type');

    const ok = await preflight(allowed);
    const refused = await preflight('https://evil.example');

    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-methods']).toContain('PATCH');
    expect(ok.headers['access-control-max-age']).toBe('600');
    expect(refused.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limits (the production values)', () => {
  // A fresh app per test: each one has its own counters.
  const strictApi = () => request(createApp({ rateLimits: PRODUCTION_RATE_LIMITS }));

  it('returns 429 with Retry-After after 5 failed logins in a minute', async () => {
    const app = strictApi();
    const user = await createUser();
    const attempt = () =>
      app.post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password' });

    for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(blocked.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(blocked.body.type).toMatch(/#too-many-requests$/);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(60);
    expect(blocked.headers['ratelimit']).toBeDefined();
  });

  it('blocks even a correct password once the limit is reached', async () => {
    const app = strictApi();
    const user = await createUser();
    for (let i = 0; i < 5; i++) {
      await app.post('/api/v1/auth/login').send({ email: user.email, password: 'wrong-password' });
    }

    const res = await app
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(429);
  });

  it('never counts a successful login', async () => {
    const app = strictApi();
    const user = await createUser();

    for (let i = 0; i < 8; i++) {
      const res = await app
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
    }
  });

  it('limits registrations to 5 a minute', async () => {
    const app = strictApi();
    const register = (i: number) =>
      app
        .post('/api/v1/auth/register')
        .send({ email: `new-${i}@kursi.test`, password: 'a-long-password', name: 'New' });

    for (let i = 0; i < 5; i++) expect((await register(i)).status).toBe(201);
    expect((await register(5)).status).toBe(429);
  });

  it("can't be dodged with a fake X-Forwarded-For while trust proxy is off", async () => {
    const app = strictApi();
    const user = await createUser();

    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await app
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `203.0.113.${i}`)
        .send({ email: user.email, password: 'wrong-password' });
      statuses.push(res.status);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('never limits the health checks', async () => {
    const app = createApp({ rateLimits: { ...PRODUCTION_RATE_LIMITS, api: 2 } });

    for (let i = 0; i < 5; i++) expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/api/v1/events')).status).toBe(200);
    expect((await request(app).get('/api/v1/events')).status).toBe(200);
    expect((await request(app).get('/api/v1/events')).status).toBe(429);
  });
});

describe('database errors no service translated', () => {
  // Routes that break database rules directly, behind the real error handler.
  const app = express();
  app.use(requestLogger);
  app.post('/duplicate-email', async () => {
    await db.insert(users).values({ email: 'taken@kursi.test', name: 'Two', passwordHash: 'x' });
  });
  app.post('/overbook/:id', async (req) => {
    await db.update(events).set({ seatsBooked: 999 }).where(eq(events.id, req.params.id!));
  });
  app.post('/missing-organizer', async () => {
    await createEvent({ organizerId: '0199a3c2-0000-7000-8000-00000000ffff' });
  });
  app.post('/delete-organizer/:id', async (req) => {
    await db.delete(users).where(eq(users.id, req.params.id!));
  });
  app.post('/slow', async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = 50`);
      await tx.execute(sql`SELECT pg_sleep(1)`);
    });
  });
  app.use(errorHandler);

  it('answers a unique violation with 409', async () => {
    await createUser({ email: 'taken@kursi.test' });

    const res = await request(app).post('/duplicate-email');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ type: expect.stringMatching(/#conflict$/), status: 409 });
    expect(JSON.stringify(res.body)).not.toMatch(/users_email_unique|duplicate key/);
  });

  it('answers a CHECK violation with 409 instead of a 500', async () => {
    const event = await createEvent({ capacity: 10 });

    const res = await request(app).post(`/overbook/${event.id}`);

    expect(res.status).toBe(409);
    expect(res.body.detail).toBe('This would break a rule the stored data must follow.');
  });

  it('answers a missing foreign key with 404, and a still-referenced row with 409', async () => {
    const organizer = await createUser();
    await createEvent({ organizerId: organizer.id });

    expect((await request(app).post('/missing-organizer')).status).toBe(404);
    expect((await request(app).post(`/delete-organizer/${organizer.id}`)).status).toBe(409);
  });

  it('answers a statement that ran past its timeout with 503', async () => {
    const res = await request(app).post('/slow');

    expect(res.status).toBe(503);
    expect(res.body.type).toMatch(/#database-timeout$/);
  });

  it('finds the Postgres code whether or not Drizzle wrapped the error', () => {
    const pgError = { code: '23505', constraint: 'users_email_unique' };

    expect(pgErrorOf(pgError)).toEqual(pgError);
    expect(pgErrorOf(new Error('Failed query', { cause: pgError }))).toEqual(pgError);
    expect(pgErrorOf(new Error('not from Postgres'))).toBeUndefined();
    expect(databaseProblem(new Error('not from Postgres'))).toBeUndefined();
  });
});

describe('database connection settings', () => {
  it('stops any statement after 5 s and any idle open transaction after 10 s', async () => {
    const show = async (setting: string) => {
      const { rows } = await db.execute<Record<string, string>>(sql.raw(`SHOW ${setting}`));
      return rows[0]?.[setting];
    };

    expect(await show('statement_timeout')).toBe('5s');
    expect(await show('idle_in_transaction_session_timeout')).toBe('10s');
  });
});

describe('log redaction', () => {
  it('replaces tokens, cookies and passwords with [Redacted]', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const log = pino({ redact: REDACTED_PATHS }, sink);

    log.info({
      req: { headers: { authorization: 'Bearer eyJsecret', cookie: 'refresh_token=abc123' } },
      res: { headers: { 'set-cookie': 'refresh_token=def456; HttpOnly' } },
      body: { email: 'ali@kursi.test', password: 'hunter2-hunter2' },
      user: { passwordHash: '$argon2id$v=19$secret' },
      refreshToken: 'ghi789',
    });

    const line = lines.join('');
    expect(line).not.toMatch(/eyJsecret|abc123|def456|hunter2|argon2id|ghi789/);
    expect(line.match(/\[Redacted\]/g)).toHaveLength(6);
    expect(line).toContain('ali@kursi.test');
  });
});
