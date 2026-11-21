import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { errors, jwtVerify, SignJWT } from "jose";

import { env } from "~backend/config/env";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ISSUER = "hacknation-asi";
const AUDIENCE = "hacknation-asi";
const key = new TextEncoder().encode(env.JWT_SECRET);

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

/** Carries identity only; role and permissions are read from the database on every request. */
export async function signAccessToken({ userId, sessionId }: AccessTokenClaims): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key);
}

/** `null` for anything that is not a valid, unexpired token of ours. */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return null;
    return { userId: payload.sub, sessionId: payload.sid };
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
}

// The refresh token is `<sessionId>.<secret>`; the database keeps only sha256(secret).
// A fast hash is enough: the secret is 256 random bits, not a password.
const REFRESH_TOKEN_PATTERN = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

export function createRefreshSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString("base64url");
  return { secret, hash: hashRefreshSecret(secret) };
}

export function hashRefreshSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function formatRefreshToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseRefreshToken(token: string): { sessionId: string; secret: string } | null {
  const match = REFRESH_TOKEN_PATTERN.exec(token);
  if (!match?.[1] || !match[2]) return null;
  return { sessionId: match[1], secret: match[2] };
}

export function hashesEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
