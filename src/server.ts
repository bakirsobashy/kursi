import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb } from './db/client.js';
import { logger } from './lib/logger.js';
import { prepareDummyHash } from './lib/passwords.js';
import { createShutdown } from './lib/shutdown.js';

const app = createApp();

// About 0.1 s of Argon2 work, done before the first request rather than during it.
await prepareDummyHash();

const server = app.listen(env.PORT, (error) => {
  if (error) {
    logger.fatal({ err: error }, `Could not listen on port ${env.PORT}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`Kursi is listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

// Docker and most process managers send SIGTERM to stop a container; Ctrl+C sends SIGINT.
// `once`: a second Ctrl+C falls through to Node's default and stops the process at once.
const shutdown = createShutdown({ server, closeDb, logger });
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void shutdown(signal));
}
