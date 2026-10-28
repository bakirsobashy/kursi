import { AppError } from '../lib/errors.js';

/** The fields of a Postgres error that the app acts on. */
interface PgError {
  code: string;
  constraint?: string;
  detail?: string;
}

/**
 * Finds the Postgres error behind a failed query. Drizzle wraps the driver's error in its own,
 * so this checks both the error and its cause.
 */
export function pgErrorOf(error: unknown): PgError | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (typeof candidate === 'object' && candidate !== null && 'code' in candidate) {
      const { code, constraint, detail } = candidate as Record<string, unknown>;
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
        return {
          code,
          ...(typeof constraint === 'string' && { constraint }),
          ...(typeof detail === 'string' && { detail }),
        };
      }
    }
  }
  return undefined;
}

/** True when the error is a unique violation (23505), optionally of one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string) {
  const pgError = pgErrorOf(error);
  return (
    pgError?.code === '23505' && (constraint === undefined || pgError.constraint === constraint)
  );
}

/**
 * The one place that turns database errors into HTTP problems. Services translate the
 * violations they expect into specific answers (such as "Event is sold out"); anything they
 * don't, reaches this function through the error handler. Without it, a rule enforced by the
 * database, which is working exactly as designed, would come back as a 500.
 * Returns undefined for errors that aren't from Postgres, or that it can't explain.
 */
export function databaseProblem(error: unknown): AppError | undefined {
  const pgError = pgErrorOf(error);
  switch (pgError?.code) {
    case '23505': // unique_violation
      return new AppError('conflict', {
        detail: 'This would duplicate a value that must be unique.',
        cause: error,
      });
    case '23514': // check_violation
      return new AppError('conflict', {
        detail: 'This would break a rule the stored data must follow.',
        cause: error,
      });
    case '23503': // foreign_key_violation
      // On a delete, other rows still point at this one; on an insert or update, the row it
      // points at doesn't exist.
      return pgError.detail?.includes('is still referenced')
        ? new AppError('conflict', {
            detail: 'Other records still depend on this one.',
            cause: error,
          })
        : new AppError('not-found', {
            detail: 'Something this request refers to does not exist.',
            cause: error,
          });
    case '57014': // query_canceled: statement_timeout ran out
      return new AppError('database-timeout', {
        detail: 'The request was stopped after 5 seconds. Try again in a moment.',
        cause: error,
      });
    case '40P01': // deadlock_detected
    case '40001': // serialization_failure
      return new AppError('database-busy', {
        detail: 'The request clashed with another one at the same moment. Try again.',
        cause: error,
      });
    default:
      return undefined;
  }
}
