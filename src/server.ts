import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';

const app = createApp();

app.listen(env.PORT, (error) => {
  if (error) {
    logger.fatal({ err: error }, `Could not listen on port ${env.PORT}`);
    process.exitCode = 1;
    return;
  }
  logger.info(`Kursi is listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});
