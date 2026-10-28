import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/client.js';
import { logger } from '../src/lib/logger.js';
import { api } from './helpers.js';

/** The request log lines written while `run` runs, at level info. */
async function requestLogLines(run: () => Promise<unknown>) {
  const stream = (logger as unknown as Record<symbol, { write: (line: string) => boolean }>)[
    pino.symbols.streamSym
  ]!;
  const lines: string[] = [];
  const write = vi.spyOn(stream, 'write').mockImplementation((line: string) => {
    lines.push(line);
    return true;
  });
  const level = logger.level;
  logger.level = 'info';
  try {
    await run();
  } finally {
    logger.level = level;
    write.mockRestore();
  }
  return lines.map((line) => (JSON.parse(line) as { msg: string }).msg);
}

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('request logs', () => {
  it("leave out /health, which Docker's HEALTHCHECK calls every 10 seconds", async () => {
    const messages = await requestLogLines(async () => {
      await api().get('/health');
      await api().get('/ready');
    });

    expect(messages).toEqual(['GET /ready 200']);
  });
});

describe('GET /ready', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 when the database answers', async () => {
    const res = await api().get('/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('returns a 503 problem when the database is unreachable', async () => {
    vi.spyOn(db, 'execute').mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'));

    const res = await api().get('/ready');

    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({
      type: expect.stringMatching(/#not-ready$/),
      title: 'Service not ready',
      status: 503,
      detail: 'The database is not reachable.',
      instance: '/ready',
    });
    // The underlying error stays in the logs.
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });
});
