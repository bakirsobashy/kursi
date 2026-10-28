import { describe, expect, it } from 'vitest';
import { eventExample, userExample } from '../src/docs/examples.js';
import { problemType } from '../src/lib/errors.js';
import { check } from './contract.js';

// The contract check is what keeps the docs honest, so it gets tests of its own: each kind of
// drift between a response and the docs has to be caught.

const JSON_TYPE = { 'content-type': 'application/json; charset=utf-8' };
const PROBLEM_TYPE = { 'content-type': 'application/problem+json; charset=utf-8' };
const EVENT = `/api/v1/events/${eventExample.id}`;

const problemBody = (slug: Parameters<typeof problemType>[0], title: string, status: number) =>
  JSON.stringify({ type: problemType(slug), title, status, instance: EVENT, requestId: 'r-1' });

describe('the contract check', () => {
  it('passes a response the docs describe', () => {
    expect(check('GET', EVENT, 200, JSON_TYPE, JSON.stringify(eventExample))).toBeUndefined();
  });

  it('reads the path without its query string', () => {
    expect(check('GET', `${EVENT}?x=1`, 200, JSON_TYPE, JSON.stringify(eventExample))).toBe(
      undefined,
    );
  });

  it('catches a field the docs leave out', () => {
    const body = JSON.stringify({ ...eventExample, secret: 'leaked' });

    expect(check('GET', EVENT, 200, JSON_TYPE, body)).toMatch(/body its docs don't describe/);
  });

  it('catches a documented field that is missing or has the wrong type', () => {
    const withoutSeatsLeft: Partial<typeof eventExample> = { ...eventExample };
    delete withoutSeatsLeft.seatsLeft;

    expect(check('GET', EVENT, 200, JSON_TYPE, JSON.stringify(withoutSeatsLeft))).toMatch(
      /seatsLeft/,
    );
    expect(
      check('GET', EVENT, 200, JSON_TYPE, JSON.stringify({ ...eventExample, capacity: '3' })),
    ).toMatch(/capacity/);
  });

  it('catches a status the docs do not list for the route', () => {
    expect(check('GET', EVENT, 418, JSON_TYPE, '{}')).toMatch(/a status its docs don't list/);
  });

  it('accepts any server error as `default`, but holds its body to the docs', () => {
    const internal = problemBody('internal-error', 'Internal server error', 500);
    const unlisted = problemBody('event-sold-out', 'Event is sold out', 500);

    expect(check('GET', EVENT, 500, PROBLEM_TYPE, internal)).toBeUndefined();
    expect(check('GET', EVENT, 500, PROBLEM_TYPE, unlisted)).toMatch(/type/);
  });

  it('catches a problem type the docs do not list for that response', () => {
    const notFound = problemBody('not-found', 'Resource not found', 404);
    const routeNotFound = problemBody('route-not-found', 'Route not found', 404);

    expect(check('GET', EVENT, 404, PROBLEM_TYPE, notFound)).toBeUndefined();
    expect(check('GET', EVENT, 404, PROBLEM_TYPE, routeNotFound)).toMatch(/type/);
  });

  it('catches the wrong content type', () => {
    const body = problemBody('not-found', 'Resource not found', 404);

    expect(check('GET', EVENT, 404, JSON_TYPE, body)).toMatch(/application\/problem\+json/);
  });

  it('catches a missing or malformed documented header', () => {
    const body = JSON.stringify(userExample);
    const register = '/api/v1/auth/register';

    expect(
      check('POST', register, 201, { ...JSON_TYPE, location: '/api/v1/users/me' }, body),
    ).toBeUndefined();
    expect(check('POST', register, 201, JSON_TYPE, body)).toMatch(/Location/);
    expect(check('POST', register, 201, { ...JSON_TYPE, location: '/elsewhere' }, body)).toMatch(
      /Location/,
    );
  });

  it('catches a body on a response documented as empty', () => {
    const cookie = { 'set-cookie': ['refresh_token=; Path=/api/v1/auth'] };

    expect(check('POST', '/api/v1/auth/logout', 204, cookie, '')).toBeUndefined();
    expect(check('POST', '/api/v1/auth/logout', 204, cookie, '{}')).toMatch(/has none/);
  });

  it('catches a route the docs are missing, unless it only failed', () => {
    const notFound = problemBody('route-not-found', 'Route not found', 404);

    expect(check('DELETE', EVENT, 200, JSON_TYPE, '{}')).toMatch(/the API docs have no DELETE/);
    expect(check('DELETE', EVENT, 404, PROBLEM_TYPE, notFound)).toBeUndefined();
    expect(check('GET', '/docs', 200, { 'content-type': 'text/html' }, '<html>')).toBeUndefined();
  });
});
