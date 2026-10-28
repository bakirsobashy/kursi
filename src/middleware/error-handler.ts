import { STATUS_CODES } from 'node:http';
import type { ErrorRequestHandler, Request } from 'express';
import { ZodError } from 'zod';
import { databaseProblem } from '../db/errors.js';
import { AppError, problemType } from '../lib/errors.js';

/** The RFC 9457 Problem Details body every error response uses. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  requestId: string;
  errors?: { path: string; message: string }[];
}

/** Errors from Express's own body parser carry these fields (the http-errors convention). */
interface HttpError {
  status: number;
  expose: boolean;
  type?: string;
}

const isHttpError = (error: unknown): error is HttpError =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as HttpError).status === 'number' &&
  (error as HttpError).expose === true;

function toProblem(error: unknown, req: Request): Problem {
  // The path only, as in RFC 9457's examples; the full URL stays in the request log.
  const instance = req.originalUrl.split('?', 1).at(0) ?? '/';
  const requestId = String(req.id);

  if (error instanceof ZodError) {
    return {
      type: problemType('validation-failed'),
      title: 'Your request has invalid fields',
      status: 400,
      detail: 'See errors for each field that failed validation.',
      instance,
      requestId,
      errors: error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    };
  }

  if (error instanceof AppError) {
    return {
      type: error.type,
      title: error.title,
      status: error.status,
      ...(error.detail !== undefined && { detail: error.detail }),
      instance,
      requestId,
    };
  }

  if (isHttpError(error) && error.type === 'entity.parse.failed') {
    return {
      type: problemType('malformed-json'),
      title: 'The request body is not valid JSON',
      status: 400,
      instance,
      requestId,
    };
  }

  if (isHttpError(error) && error.type === 'entity.too.large') {
    return {
      type: problemType('payload-too-large'),
      title: 'The request body is too large',
      status: 413,
      detail: 'Request bodies are limited to 100 kB.',
      instance,
      requestId,
    };
  }

  // Any other client error from Express itself, such as an unsupported charset.
  if (isHttpError(error) && error.status >= 400 && error.status < 500) {
    return {
      type: 'about:blank',
      title: STATUS_CODES[error.status] ?? 'Bad request',
      status: error.status,
      instance,
      requestId,
    };
  }

  return {
    type: problemType('internal-error'),
    title: 'Internal server error',
    status: 500,
    detail: 'Something went wrong on our side. Quote the request ID if you report it.',
    instance,
    requestId,
  };
}

/** The last middleware: every thrown or forwarded error ends here. */
export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  // Too late to send an error body; Express's default handler closes the connection.
  if (res.headersSent) return next(error);

  // A database rule that no service translated still gets a meaningful answer.
  const fromDatabase = error instanceof AppError ? undefined : databaseProblem(error);
  if (fromDatabase && fromDatabase.status < 500) {
    // Worth a look: the database caught something the code didn't expect.
    req.log.warn({ err: error }, 'A database rule refused the request');
  }
  const handled: unknown = fromDatabase ?? error;
  const problem = toProblem(handled, req);

  // Unexpected errors go into the request's log line in full, with their stack;
  // the caller only sees the generic body above.
  if (problem.status >= 500) {
    res.err = handled instanceof Error ? handled : new Error(String(handled));
  }

  // HTTP requires every 401 to say how to authenticate. `authenticate` sets a more specific one.
  if (problem.status === 401 && !res.hasHeader('WWW-Authenticate')) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="kursi"');
  }

  res.status(problem.status).type('application/problem+json').json(problem);
};
