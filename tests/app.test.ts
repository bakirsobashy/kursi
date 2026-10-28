import { describe, expect, it } from 'vitest';
import { api } from './helpers.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request IDs', () => {
  it('gives every response a new X-Request-Id', async () => {
    const first = await api().get('/health');
    const second = await api().get('/health');

    expect(first.headers['x-request-id']).toMatch(UUID);
    expect(second.headers['x-request-id']).toMatch(UUID);
    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('reuses a valid incoming X-Request-Id, lowercased', async () => {
    const res = await api()
      .get('/health')
      .set('X-Request-Id', '6F1C9E0A-4B0E-4A8E-9A43-0C7A2F6D1E55');

    expect(res.headers['x-request-id']).toBe('6f1c9e0a-4b0e-4a8e-9a43-0c7a2f6d1e55');
  });

  it('replaces an X-Request-Id that is not a UUID', async () => {
    const res = await api().get('/health').set('X-Request-Id', '<script>alert(1)</script>');

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('puts the same ID in the body of an error response', async () => {
    const res = await api().get('/nope');

    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('errors from the app itself', () => {
  it('returns a 404 problem for an unknown route, without the query string', async () => {
    const res = await api().get('/nope?token=secret');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toEqual({
      type: 'https://github.com/bakirsobashy/kursi/blob/main/docs/problems.md#route-not-found',
      title: 'Route not found',
      status: 404,
      detail: 'No route matches GET /nope.',
      instance: '/nope',
      requestId: expect.stringMatching(UUID),
    });
  });

  it('returns 400 for a malformed JSON body', async () => {
    const res = await api()
      .post('/health')
      .set('Content-Type', 'application/json')
      .send('{"capacity": 10,}');

    expect(res.status).toBe(400);
    expect(res.body.type).toMatch(/#malformed-json$/);
  });

  it('returns 413 for a body over 100 kB', async () => {
    const res = await api()
      .post('/health')
      .send({ padding: 'a'.repeat(110_000) });

    expect(res.status).toBe(413);
    expect(res.body.type).toMatch(/#payload-too-large$/);
  });

  it('returns 415 as about:blank for an unsupported charset', async () => {
    const res = await api()
      .post('/health')
      .set('Content-Type', 'application/json; charset=klingon')
      .send('{}');

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ type: 'about:blank', title: 'Unsupported Media Type' });
  });

  it('does not advertise Express in X-Powered-By', async () => {
    const res = await api().get('/health');

    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
