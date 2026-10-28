import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { closeDb } from './client.js';
import { runMigrations } from './migrate.js';
import { seedAndReport } from './seed.js';

/**
 * Gets the database ready for the API: applies the migrations, then adds the demo data when
 * SEED_DEMO_DATA=true. In Docker Compose, the migrate service runs this once before the API
 * starts. The demo accounts share a public password, so a real deployment leaves
 * SEED_DEMO_DATA unset and gets the migrations alone, from the same image.
 */
export async function prepareDatabase({ seedDemoData = env.SEED_DEMO_DATA } = {}) {
  await runMigrations();
  if (!seedDemoData) {
    logger.info('Skipped the demo data: SEED_DEMO_DATA is not true');
    return;
  }
  if (env.NODE_ENV === 'production') {
    logger.warn(
      'Adding the demo accounts, whose password is public. Never set SEED_DEMO_DATA on a real deployment.',
    );
  }
  await seedAndReport();
}

// Runs only as a script (node dist/db/setup.js), so tests can import prepareDatabase().
if (import.meta.main) {
  try {
    await prepareDatabase();
  } catch (error) {
    logger.fatal({ err: error }, 'Database setup failed');
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
