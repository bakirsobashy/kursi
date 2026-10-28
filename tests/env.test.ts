import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '../src/config/env.js';

const valid = {
  DATABASE_URL: 'postgres://kursi:kursi@localhost:5432/kursi',
  JWT_ACCESS_SECRET: 'a-secret-that-is-at-least-32-characters',
};

const problemsFor = (source: NodeJS.ProcessEnv) => {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  throw new Error('Expected parseEnv to fail');
};

describe('parseEnv', () => {
  it('applies defaults for everything optional', () => {
    expect(parseEnv(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_SECONDS: 604_800,
      CORS_ORIGINS: [],
    });
  });

  it('lists every missing required variable at once', () => {
    expect(problemsFor({})).toEqual([
      'DATABASE_URL: is required',
      'JWT_ACCESS_SECRET: is required',
    ]);
  });

  it('names each bad variable without printing its value', () => {
    const problems = problemsFor({
      DATABASE_URL: 'mysql://root:topsecret@localhost/db',
      JWT_ACCESS_SECRET: 'short-and-secret',
      PORT: '99999',
    });

    expect(problems).toEqual([
      'PORT: must be a whole number from 1 to 65535',
      'DATABASE_URL: must be a postgres:// URL',
      'JWT_ACCESS_SECRET: must be at least 32 characters',
    ]);
    expect(problems.join(' ')).not.toMatch(/topsecret|short-and-secret/);
  });

  it('accepts postgresql:// as well as postgres://', () => {
    expect(() =>
      parseEnv({ ...valid, DATABASE_URL: 'postgresql://u:p@db:5432/kursi' }),
    ).not.toThrow();
  });

  it('coerces numbers from strings', () => {
    const env = parseEnv({ ...valid, PORT: '8080', ACCESS_TOKEN_TTL_SECONDS: '60' });

    expect(env.PORT).toBe(8080);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(60);
  });

  it('splits CORS_ORIGINS into a trimmed list', () => {
    const env = parseEnv({
      ...valid,
      CORS_ORIGINS: ' http://localhost:5173 , https://kursi.app ,',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://kursi.app']);
  });

  it('rejects a CORS origin that is not an http(s) URL', () => {
    expect(problemsFor({ ...valid, CORS_ORIGINS: 'http://localhost:5173,kursi.app' })).toEqual([
      'CORS_ORIGINS: must be a comma-separated list of http(s) origins',
    ]);
  });

  it('rejects an unknown NODE_ENV or LOG_LEVEL', () => {
    const problems = problemsFor({ ...valid, NODE_ENV: 'staging', LOG_LEVEL: 'loud' });

    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^NODE_ENV: /);
    expect(problems[1]).toMatch(/^LOG_LEVEL: /);
  });
});
