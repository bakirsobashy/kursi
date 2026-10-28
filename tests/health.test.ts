import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../src/db/client.js';
import { api } from './helpers.js';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
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
