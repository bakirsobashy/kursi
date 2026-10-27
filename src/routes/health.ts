import { Router } from 'express';

export const healthRouter = Router();

/** Liveness: the process is up and serving HTTP. It checks nothing else on purpose. */
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});
