import type { RequestHandler } from 'express';
import { NotFoundError } from '../lib/errors.js';

/** Runs only when no route matched, and hands a 404 to the error handler. */
export const notFound: RequestHandler = (req) => {
  throw new NotFoundError({
    slug: 'route-not-found',
    title: 'Route not found',
    detail: `No route matches ${req.method} ${req.path}.`,
  });
};
