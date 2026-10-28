import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Runs once per `npm test`, before any test file.
 * By default it starts a throwaway Postgres 18 in Docker, so tests never touch your dev data.
 * With TEST_DATABASE_URL set, it uses that database instead (for machines without Docker).
 */
export default async function setup(project: TestProject) {
  let container: StartedPostgreSqlContainer | undefined;
  let databaseUrl = process.env.TEST_DATABASE_URL;

  if (databaseUrl) {
    // The tests empty every table, so refuse anything that doesn't look like a test database.
    const name = new URL(databaseUrl).pathname.slice(1);
    if (!name.includes('test')) {
      fail(
        `TEST_DATABASE_URL points at "${name}". The tests delete all data, so its name must contain "test".`,
      );
    }
  } else {
    try {
      container = await new PostgreSqlContainer('postgres:18-alpine').start();
    } catch (error) {
      fail(
        `Could not start a Postgres container for the tests: ${messageOf(error)}\n` +
          'Start Docker Desktop, or set TEST_DATABASE_URL to an empty Postgres database whose name contains "test".',
      );
    }
    databaseUrl = container.getConnectionUri();
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'migrations' });
  } catch (error) {
    await container?.stop();
    fail(`Could not migrate the test database: ${messageOf(error)}`);
  } finally {
    await pool.end();
  }

  project.provide('databaseUrl', databaseUrl);

  return async () => {
    await container?.stop();
  };
}

const messageOf = (error: unknown) => {
  const cause = (error as { cause?: unknown }).cause;
  const message = error instanceof Error ? error.message : String(error);
  return cause instanceof Error ? `${message} (${cause.message})` : message;
};

/**
 * Stops the run with a readable message. Vite's stack-trace rewriting crashes on errors
 * thrown from global setup ("code.charCodeAt is not a function") and hides the real message,
 * so the error gets a plain stack before anything reads it.
 */
function fail(message: string): never {
  const error = new Error(message);
  error.stack = `Error: ${message}`;
  throw error;
}
