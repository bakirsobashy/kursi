import type { Request, RequestHandler } from 'express';
import { errors } from 'jose';
import { AppError, ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { verifyAccessToken, type AuthUser } from '../lib/tokens.js';
import type { userRole } from '../db/schema.js';

const BEARER = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/;

/**
 * Lets a request through only with a valid access token in `Authorization: Bearer <token>`,
 * and attaches its user as `req.user`. Every refusal is a 401 with a WWW-Authenticate header,
 * as RFC 6750 asks, so clients can tell "log in" apart from "refresh your token".
 */
export const authenticate: RequestHandler = async (req, res, next) => {
  const match = BEARER.exec(req.get('authorization') ?? '');
  if (!match) {
    throw new UnauthorizedError({
      detail: 'Send an access token in an Authorization: Bearer <token> header.',
    });
  }

  try {
    req.user = await verifyAccessToken(match[1]!);
  } catch (error) {
    const expired = error instanceof errors.JWTExpired;
    const detail = expired
      ? 'The access token has expired. Refresh it or log in again.'
      : 'The access token is not valid.';
    res.setHeader(
      'WWW-Authenticate',
      `Bearer realm="kursi", error="invalid_token", error_description="${detail}"`,
    );
    throw new AppError(401, { slug: 'invalid-token', title: 'Invalid access token', detail });
  }

  next();
};

/** The authenticated user. Use it in handlers behind `authenticate`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

/** Lets a request through only when `authenticate` found a user with this role. */
export const requireRole =
  (role: (typeof userRole.enumValues)[number]): RequestHandler =>
  (req, _res, next) => {
    if (currentUser(req).role !== role) {
      throw new ForbiddenError({ detail: `This needs the ${role} role.` });
    }
    next();
  };
