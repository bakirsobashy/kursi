import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/lib/errors.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { notFound } from '../src/middleware/not-found.js';
import { requestLogger } from '../src/middleware/request-logger.js';

// A small app with routes that fail on purpose, wired with the real middleware.
const app = express();
app.use(requestLogger, express.json());
app.post('/validate', (req, res) => {
  const body = z
    .object({ title: z.string().min(3), capacity: z.number().int().min(1) })
    .parse(req.body);
  res.status(201).json(body);
});
app.get('/sold-out', () => {
  throw new AppError('event-sold-out', { detail: 'All 120 seats for this event are booked.' });
});
app.get('/unauthorized', () => {
  throw new AppError('unauthorized');
});
app.get('/forbidden', () => {
  throw new AppError('forbidden');
});
app.get('/missing', () => {
  throw new AppError('not-found', { detail: 'No event has this ID.' });
});
app.get('/boom', () => {
  throw new Error('database password is hunter2');
});
app.get('/async-boom', async () => {
  await Promise.resolve();
  throw new TypeError('async failure');
});
app.get('/throws-a-string', () => {
  throw 'not an Error object';
});
app.use(notFound, errorHandler);

describe('error handler', () => {
  it('turns a Zod error into a 400 with one entry per invalid field', async () => {
    const res = await request(app).post('/validate').send({ title: 'Go', capacity: 0 });

    expect(res.status).toBe(400);
    expect(res.body.type).toMatch(/#validation-failed$/);
    expect(res.body.errors).toEqual([
      { path: 'title', message: expect.any(String) },
      { path: 'capacity', message: expect.any(String) },
    ]);
  });

  it('reports a body of the wrong shape against (root)', async () => {
    const res = await request(app).post('/validate').send([1, 2]);

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([{ path: '(root)', message: expect.any(String) }]);
  });

  it('keeps the status, type, title and detail of an AppError', async () => {
    const res = await request(app).get('/sold-out');

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      type: 'https://github.com/bakirsobashy/kursi/blob/main/docs/problems.md#event-sold-out',
      title: 'Event is sold out',
      status: 409,
      detail: 'All 120 seats for this event are booked.',
      instance: '/sold-out',
    });
  });

  it.each([
    ['/unauthorized', 401, 'unauthorized'],
    ['/forbidden', 403, 'forbidden'],
    ['/missing', 404, 'not-found'],
  ])('maps %s to %i with type #%s', async (path, status, slug) => {
    const res = await request(app).get(path);

    expect(res.status).toBe(status);
    expect(res.body.type).toMatch(new RegExp(`#${slug}$`));
  });

  it('leaves detail out when an AppError has none', async () => {
    const res = await request(app).get('/unauthorized');

    expect(res.body).not.toHaveProperty('detail');
  });

  it.each(['/boom', '/async-boom', '/throws-a-string'])(
    'turns an unexpected error at %s into a generic 500 that reveals nothing',
    async (path) => {
      const res = await request(app).get(path);

      expect(res.status).toBe(500);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(res.body).toMatchObject({ title: 'Internal server error', status: 500 });
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/hunter2|async failure|not an Error|stack|at \//);
    },
  );
});
