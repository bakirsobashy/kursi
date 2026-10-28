import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import {
  createRateLimiters,
  defaultRateLimits,
  type RateLimits,
} from './middleware/rate-limits.js';
import { requestLogger } from './middleware/request-logger.js';
import { apiRouter } from './routes/api.js';
import { docsRouter } from './routes/docs.js';
import { healthRouter } from './routes/health.js';

export interface AppOptions {
  /** Defaults to the production limits, or to very high ones when NODE_ENV=test. */
  rateLimits?: RateLimits;
}

/**
 * Builds the Express app without listening on a port, so tests can drive it directly.
 * The order matters: logging first so it sees every request, cheap refusals (CORS, rate
 * limits) before any parsing, the routes, then the error handler last.
 */
export function createApp({ rateLimits = defaultRateLimits() }: AppOptions = {}) {
  const app = express();

  // Off by default. Behind a proxy it must match the proxy setup, or req.ip (and with it
  // every rate limit) is wrong. See docs/deployment.md.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger);

  // Safe response headers: nosniff, frame and CSP protections, HSTS, no X-Powered-By.
  app.use(helmet());

  // Only the listed origins may call the API from a browser, with credentials, because the
  // refresh cookie needs them. A browser rejects a wildcard origin when credentials are on.
  // Any other origin gets no CORS headers at all, so its browser won't hand the page the reply.
  const allowedOrigins = new Set(env.CORS_ORIGINS);
  app.use(
    cors((req, callback) => {
      const origin = req.headers.origin;
      if (origin === undefined || !allowedOrigins.has(origin))
        return callback(null, { origin: false });
      callback(null, {
        origin,
        credentials: true,
        exposedHeaders: [
          'Location',
          'X-Request-Id',
          'Retry-After',
          'RateLimit',
          'RateLimit-Policy',
        ],
        maxAge: 600,
      });
    }),
  );

  const limiters = createRateLimiters(rateLimits);
  app.use('/api/v1', limiters.api);
  app.post('/api/v1/auth/login', limiters.login);
  app.post('/api/v1/auth/register', limiters.register);
  app.post('/api/v1/auth/refresh', limiters.refresh);

  app.use(express.json({ limit: '100kb' }));
  // Unsigned cookies: the refresh token is unguessable on its own, so signing adds nothing.
  app.use(cookieParser());

  // Outside /api/v1, so neither the health checks nor the docs count toward any rate limit.
  app.use(healthRouter);
  app.use(docsRouter);
  app.use('/api/v1', apiRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
