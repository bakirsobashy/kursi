import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { logger } from '../lib/logger.js';
import { closeDb, db } from './client.js';

// Resolved from this file, so it works from src/ in development and from dist/ in production.
const migrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Applies, in order, every migration not yet recorded in drizzle.__drizzle_migrations. */
export async function runMigrations() {
  await migrate(db, { migrationsFolder });
  logger.info('Database migrations are up to date');
}

// Runs only as a script (npm run db:migrate), so setup.ts can import runMigrations().
if (import.meta.main) {
  try {
    await runMigrations();
  } catch (error) {
    logger.fatal({ err: error }, 'Database migration failed');
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
