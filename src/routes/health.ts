import { Router } from 'express';
import type { HealthResponse, ReadyResponse } from '../schemas/health.js';
import { assertDatabaseReady } from '../services/health.js';

export const healthRouter = Router();

/** Liveness: the process is up and serving HTTP. It checks nothing else on purpose. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' } satisfies HealthResponse);
});

/** Readiness: the app can do real work, which here means the database answers a query. */
healthRouter.get('/ready', async (_req, res) => {
  await assertDatabaseReady();
  res.json({ status: 'ready' } satisfies ReadyResponse);
});
