import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { logger } from '../lib/logger.js';
import { closeDb, db } from './client.js';

// Resolved from this file, so it works from src/ in development and from dist/ in production.
const migrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url));

try {
  // Applies, in order, every migration not yet recorded in drizzle.__drizzle_migrations.
  await migrate(db, { migrationsFolder });
  logger.info('Database migrations are up to date');
} catch (error) {
  logger.fatal({ err: error }, 'Database migration failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
