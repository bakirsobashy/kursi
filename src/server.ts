import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prepareDummyHash } from './lib/passwords.js';

const app = createApp();

// About 0.1 s of Argon2 work, done before the first request rather than during it.
await prepareDummyHash();

app.listen(env.PORT, (error) => {
  if (error) {
    logger.fatal({ err: error }, `Could not listen on port ${env.PORT}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`Kursi is listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
