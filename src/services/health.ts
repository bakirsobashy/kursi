import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { AppError } from '../lib/errors.js';

/** Throws a 503 unless the database answers a trivial query. */
export async function assertDatabaseReady() {
  try {
    await db.execute(sql`select 1`);
  } catch (error) {
    throw new AppError('not-ready', { detail: 'The database is not reachable.', cause: error });
  }
}
