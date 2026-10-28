import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env.js';

export const REFRESH_COOKIE = 'refresh_token';

/**
 * - HttpOnly: page scripts can't read it, so an XSS bug can't steal the session.
 * - SameSite=Strict: browsers don't send it with requests started by other sites (no CSRF).
 * - Path=/api/v1/auth: it's sent to the auth endpoints only, never with ordinary API calls.
 * - Secure in production: only ever sent over HTTPS.
 */
export function refreshCookieOptions(production = env.NODE_ENV === 'production'): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: production,
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions());
}

/**
 * Tells the browser to delete the cookie. It must name the same path, or nothing is deleted.
 * Express 5 ignores maxAge here and sends an expiry date in 1970.
 */
export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
}

export function readRefreshCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
