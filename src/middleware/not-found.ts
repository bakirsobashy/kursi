import type { RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';

/** Runs only when no route matched, and hands a 404 to the error handler. */
export const notFound: RequestHandler = (req) => {
  throw new AppError('route-not-found', { detail: `No route matches ${req.method} ${req.path}.` });
};
