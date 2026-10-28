import { STATUS_CODES } from 'node:http';
import type { ErrorRequestHandler, Request } from 'express';
import { ZodError } from 'zod';
import { databaseProblem } from '../db/errors.js';
import { PROBLEMS, problemType, AppError, type ProblemSlug } from '../lib/errors.js';
import type { Problem } from '../schemas/problem.js';

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

/** The `errors` of a validation-failed problem: each invalid field, and what is wrong with it. */
export const fieldErrors = (error: ZodError) =>
  error.issues.map((issue) => ({
    path: issue.path.map(String).join('.') || '(root)',
    message: issue.message,
  }));

function toProblem(error: unknown, req: Request): Problem {
  // The path only, as in RFC 9457's examples; the full URL stays in the request log.
  const instance = req.originalUrl.split('?', 1).at(0) ?? '/';
  const requestId = String(req.id);
  const problem = (slug: ProblemSlug, detail?: string) => ({
    type: problemType(slug),
    title: PROBLEMS[slug].title,
    status: PROBLEMS[slug].status,
    ...(detail !== undefined && { detail }),
    instance,
    requestId,
  });

  if (error instanceof ZodError) {
    return {
      ...problem('validation-failed', 'See errors for each field that failed validation.'),
      errors: fieldErrors(error),
    };
  }

  if (error instanceof AppError) return problem(error.slug, error.detail);

  if (isHttpError(error) && error.type === 'entity.parse.failed') {
    return problem('malformed-json');
  }

  if (isHttpError(error) && error.type === 'entity.too.large') {
    return problem('payload-too-large', 'Request bodies are limited to 100 kB.');
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

  return problem(
    'internal-error',
    'Something went wrong on our side. Quote the request ID if you report it.',
  );
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
