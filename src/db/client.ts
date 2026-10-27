import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema.js';

/** One connection pool for the whole process. It connects lazily, on the first query. */
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  // Fail fast when the database is down, rather than leaving requests hanging.
  connectionTimeoutMillis: 5_000,
});

// An idle connection can die, for example when the database restarts. Without this listener,
// that 'error' event would crash the process; with it, the pool just opens a new connection.
pool.on('error', (error) => {
  logger.warn({ err: error }, 'An idle database connection failed');
});

export const db = drizzle({ client: pool, schema });
export type Db = typeof db;

/** Closes every connection. Used by shutdown, scripts and tests. */
export async function closeDb() {
  await pool.end();
}
