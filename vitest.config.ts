import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Starts one Postgres for the whole run and migrates it (or uses TEST_DATABASE_URL).
    globalSetup: ['./tests/global-setup.ts'],
    // Runs before each test file: points the app's config at that database.
    setupFiles: ['./tests/setup-env.ts'],
    // Every test file shares one database. In parallel, one file's resetDb() would wipe
    // the rows another file is in the middle of using.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry points that only wire things together; the tests exercise what they call.
      exclude: ['src/server.ts', 'src/db/migrate.ts'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
