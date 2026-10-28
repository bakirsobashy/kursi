import express from 'express';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { requestLogger } from './middleware/request-logger.js';
import { apiRouter } from './routes/api.js';
import { healthRouter } from './routes/health.js';

/**
 * Builds the Express app without listening on a port, so tests can drive it directly.
 * The order matters: logging first so it sees every request, the error handler last.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));

  app.use(healthRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
