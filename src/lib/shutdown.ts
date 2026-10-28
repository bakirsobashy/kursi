import type { Server } from 'node:http';
import type { Logger } from 'pino';

interface ShutdownOptions {
  server: Server;
  closeDb: () => Promise<void>;
  logger: Logger;
  /** How long requests in progress get to finish. */
  timeoutMs?: number;
  /** Injected so tests can check the exit code without ending the test run. */
  exit?: (code: number) => void;
}

/**
 * Returns a function that shuts the API down gracefully: stop accepting connections, let
 * requests in progress finish (cut off after `timeoutMs`), close the database pool, then exit
 * with 0, or with 1 if requests had to be cut off. Calling it again does nothing.
 */
export function createShutdown({
  server,
  closeDb,
  logger,
  timeoutMs = 10_000,
  exit = (code) => process.exit(code),
}: ShutdownOptions) {
  let started = false;

  return async function shutdown(signal: string) {
    if (started) return;
    started = true;
    logger.info({ signal }, 'Shutting down: no new connections; finishing requests in progress');

    let forced = false;
    const deadline = setTimeout(() => {
      forced = true;
      logger.error(`Requests still running after ${timeoutMs / 1000} s; closing them`);
      server.closeAllConnections();
    }, timeoutMs);

    // close() stops new connections and waits for the open ones. Idle keep-alive
    // connections are closed now; busy ones as soon as their response is sent.
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    const drain = setInterval(() => server.closeIdleConnections(), 100);
    await closed;
    clearInterval(drain);
    clearTimeout(deadline);

    await closeDb();
    logger.info(forced ? 'Shutdown complete, after cutting off requests' : 'Shutdown complete');
    exit(forced ? 1 : 0);
  };
}
