/** The fields of a Postgres error that the app acts on. */
interface PgError {
  code: string;
  constraint?: string;
}

/**
 * Finds the Postgres error behind a failed query. Drizzle wraps the driver's error in its own,
 * so this checks the error and its cause.
 */
export function pgErrorOf(error: unknown): PgError | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (typeof candidate === 'object' && candidate !== null && 'code' in candidate) {
      const { code, constraint } = candidate as { code: unknown; constraint?: unknown };
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
        return { code, ...(typeof constraint === 'string' && { constraint }) };
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
