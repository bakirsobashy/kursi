import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { createShutdown } from '../src/lib/shutdown.js';

// A plain HTTP server with a slow route stands in for the API, so the test controls timing.
async function startServer(slowMs: number) {
  const server = createServer((req, res) => {
    if (req.url === '/hang') return; // never answers
    setTimeout(() => res.end('done'), req.url === '/slow' ? slowMs : 0);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: (path: string) => `http://127.0.0.1:${port}${path}` };
}

function setUp(server: Server, timeoutMs = 2_000) {
  const closeDb = vi.fn(async () => {});
  const exit = vi.fn();
  const shutdown = createShutdown({
    server,
    closeDb,
    logger: pino({ level: 'silent' }),
    timeoutMs,
    exit,
  });
  return { shutdown, closeDb, exit };
}

describe('graceful shutdown', () => {
  it('finishes a request in progress, refuses new ones, closes the pool and exits with 0', async () => {
    const { server, url } = await startServer(300);
    const { shutdown, closeDb, exit } = setUp(server);

    const inFlight = fetch(url('/slow'));
    await sleep(50); // the request is now being handled
    const done = shutdown('SIGTERM');
    await sleep(20);

    await expect(fetch(url('/fast'))).rejects.toThrow();
    const res = await inFlight;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('done');

    await done;
    expect(closeDb).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('also closes idle keep-alive connections, so it never waits on them', async () => {
    const { server, url } = await startServer(0);
    const { shutdown, exit } = setUp(server);
    await (await fetch(url('/fast'))).text(); // leaves an idle keep-alive connection

    const started = Date.now();
    await shutdown('SIGTERM');

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('cuts off requests that outlast the deadline and exits with 1', async () => {
    const { server, url } = await startServer(0);
    const { shutdown, closeDb, exit } = setUp(server, 200);

    const hanging = fetch(url('/hang')).catch((error: unknown) => error);
    await sleep(50);
    await shutdown('SIGTERM');

    expect(await hanging).toBeInstanceOf(Error);
    expect(closeDb).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('runs only once, however many signals arrive', async () => {
    const { server } = await startServer(0);
    const { shutdown, closeDb } = setUp(server);

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT'), shutdown('SIGTERM')]);

    expect(closeDb).toHaveBeenCalledOnce();
  });
});
