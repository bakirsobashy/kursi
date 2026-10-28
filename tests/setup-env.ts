import { afterAll, inject } from 'vitest';

// Runs in each test file before its imports, so src/config/env.ts parses these values.
// Your .env file is never read in tests.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = inject('databaseUrl');
process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-at-least-32-characters-long';
process.env.CORS_ORIGINS = 'http://localhost:5173';
delete process.env.TRUST_PROXY;
// Set TEST_LOG_LEVEL=debug to see the app's logs while a test runs.
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL ?? 'silent';

afterAll(async () => {
  // Each test file gets its own copy of the app and its own pool; close it so the run ends cleanly.
  const { closeDb } = await import('../src/db/client.js');
  await closeDb();
});
