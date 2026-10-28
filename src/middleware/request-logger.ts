import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '../lib/logger.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gives every request an ID and logs one line when it finishes.
 * A caller's X-Request-Id is reused when it is a valid UUID, so one ID can follow a request
 * across services; anything else is replaced, so callers can't inject junk into the logs.
 */
export const requestLogger = pinoHttp<Request, Response>({
  logger,
  // Docker's HEALTHCHECK calls /health every 10 seconds; a line for each would bury the rest.
  // A failing check shows up in `docker compose ps` instead.
  autoLogging: { ignore: (req) => req.url === '/health' },
  genReqId(req, res) {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && UUID.test(incoming) ? incoming.toLowerCase() : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  // Lines logged through req.log carry just the ID rather than the whole request.
  quietReqLogger: true,
  customAttributeKeys: { reqId: 'requestId' },
  customLogLevel(_req, res, error) {
    if (error || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.originalUrl} ${res.statusCode}`,
  customErrorMessage: (req, res) => `${req.method} ${req.originalUrl} ${res.statusCode}`,
});
