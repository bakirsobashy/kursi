import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { env } from '../config/env.js';
import { userRole } from '../db/schema.js';

/*
 * Access tokens are short-lived JWTs signed with HS256. They are stateless: the API checks the
 * signature and the claims, and never looks the token up. That's why they expire after
 * 15 minutes, and why Phase 6 adds refresh tokens, which can be revoked.
 */

const ISSUER = 'kursi';
const AUDIENCE = 'kursi-api';
const ALGORITHM = 'HS256';
const secret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

/** Who made the request, as proven by a valid access token. */
export interface AuthUser {
  id: string;
  role: (typeof userRole.enumValues)[number];
}

// What a valid token must contain beyond what jose checks itself.
const claimsSchema = z.object({
  sub: z.uuid(),
  role: z.enum(userRole.enumValues),
});

export async function signAccessToken(user: AuthUser) {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

/**
 * Throws unless the token is signed with our secret using HS256, was issued by us for this API,
 * and hasn't expired. Naming the one allowed algorithm blocks tokens that claim "alg": "none"
 * or any other algorithm.
 */
export async function verifyAccessToken(token: string): Promise<AuthUser> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: [ALGORITHM],
    issuer: ISSUER,
    audience: AUDIENCE,
    requiredClaims: ['sub', 'iat', 'exp'],
  });
  const claims = claimsSchema.parse(payload);
  return { id: claims.sub, role: claims.role };
}
