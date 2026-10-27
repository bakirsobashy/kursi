import { sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client.js';
import { AppError } from '../lib/errors.js';

export const healthRouter = Router();

/** Liveness: the process is up and serving HTTP. It checks nothing else on purpose. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/** Readiness: the app can do real work, which here means the database answers a query. */
healthRouter.get('/ready', async (_req, res) => {
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    throw new AppError(503, {
      slug: 'not-ready',
      title: 'Service not ready',
      detail: 'The database is not reachable.',
      cause: error,
    });
  }
  res.json({ status: 'ready' });
});
