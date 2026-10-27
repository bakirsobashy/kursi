import { defineConfig } from 'drizzle-kit';

// Used only by `npm run db:generate`, which writes SQL migrations from the schema.
// The app applies them itself with src/db/migrate.ts, so production never needs drizzle-kit.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
