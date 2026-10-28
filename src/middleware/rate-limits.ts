import { rateLimit, type Options } from 'express-rate-limit';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/** Requests allowed per client IP per minute. */
export interface RateLimits {
  /** Failed logins only: a correct password never counts against you. */
  login: number;
  register: number;
  refresh: number;
  /** Every request under /api/v1, as a ceiling against floods. */
  api: number;
}

export const PRODUCTION_RATE_LIMITS: RateLimits = { login: 50, register: 5, refresh: 30, api: 300 };

// High enough that the test suite never trips them; one test checks the real limits.
const TEST_RATE_LIMITS: RateLimits = {
  login: 10_000,
  register: 10_000,
  refresh: 10_000,
  api: 100_000,
};

export const defaultRateLimits = () =>
  env.NODE_ENV === 'test' ? TEST_RATE_LIMITS : PRODUCTION_RATE_LIMITS;

function limiter(limit: number, options: Partial<Options> = {}) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    // RateLimit and RateLimit-Policy headers, from the IETF draft; plus Retry-After on a 429.
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Hand the 429 to the error handler, so it's Problem Details like every other error.
    // The limiter has already set Retry-After by the time this runs.
    handler: (_req, res, next) => {
      next(
        new AppError('too-many-requests', {
          detail: `Too many requests from your address. Try again in ${String(res.getHeader('Retry-After'))} seconds.`,
        }),
      );
    },
    ...options,
  });
}

/**
 * One set of limiters per app, each with its own in-memory counter. Counters live in this
 * process, so with several API instances you'd move them to a shared store such as Redis.
 */
export function createRateLimiters(limits: RateLimits) {
  return {
    login: limiter(limits.login, { skipSuccessfulRequests: true }),
    register: limiter(limits.register),
    refresh: limiter(limits.refresh),
    api: limiter(limits.api),
  };
}
