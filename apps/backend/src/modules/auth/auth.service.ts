import type {
  ChangePasswordBody,
  LoginBody,
  MeResponse,
} from "@hacknation/contracts/auth/auth.schema";

import type { Role, User } from "~backend/generated/prisma/client";
import { toPermissions, type AuthContext } from "~backend/lib/auth-context";
import { HttpError } from "~backend/lib/http-error";
import { hashPassword, verifyAgainstDummyHash, verifyPassword } from "~backend/lib/password";
import { prisma } from "~backend/lib/prisma";
import {
  createRefreshSecret,
  formatRefreshToken,
  hashesEqual,
  hashRefreshSecret,
  parseRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  signAccessToken,
} from "~backend/lib/tokens";
import { toRoleSummary } from "~backend/modules/roles/roles.mapper";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
// Two tabs refreshing at once: the loser presents the just-rotated token. Not a theft.
export const REFRESH_REUSE_GRACE_MS = 30 * 1000;
const USER_AGENT_MAX_LENGTH = 255;

export interface IssuedTokens {
  accessToken: string;
  /** Null when only the access token was renewed (the browser already holds the newest refresh token). */
  refreshToken: string | null;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toMe(user: User & { role: Role }): MeResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: toRoleSummary(user.role),
    permissions: toPermissions(user.role.permissions),
    mustChangePassword: user.mustChangePassword,
  };
}

// One answer for every failure: callers must not learn whether the email exists or is locked.
const invalidCredentials = () =>
  HttpError.unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
const sessionExpired = () => HttpError.unauthorized("Session expired");

async function createSession(userId: string, userAgent: string | undefined) {
  const { secret, hash } = createRefreshSecret();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      userAgent: userAgent?.slice(0, USER_AGENT_MAX_LENGTH),
    },
  });
  return {
    accessToken: await signAccessToken({ userId, sessionId: session.id }),
    refreshToken: formatRefreshToken(session.id, secret),
  };
}

/** Revokes every session of a user, optionally keeping one (the caller's). */
export async function revokeSessions(userId: string, keepSessionId?: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(keepSessionId ? { id: { not: keepSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

async function recordFailedLogin(userId: string): Promise<void> {
  const { failedLoginCount } = await prisma.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });
  if (failedLoginCount >= MAX_FAILED_LOGINS) {
    await prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) },
    });
  }
}

export const authService = {
  async login(
    body: LoginBody,
    userAgent: string | undefined,
  ): Promise<{ me: MeResponse; tokens: IssuedTokens }> {
    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(body.email) },
      include: { role: true },
    });
    const now = new Date();

    if (!user || !user.isActive || (user.lockedUntil && user.lockedUntil > now)) {
      await verifyAgainstDummyHash(body.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      await recordFailedLogin(user.id);
      throw invalidCredentials();
    }

    const signedIn = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      include: { role: true },
    });
    // Housekeeping: this user's dead sessions are no longer useful for reuse detection.
    await prisma.session.deleteMany({
      where: { userId: user.id, OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
    });

    return { me: toMe(signedIn), tokens: await createSession(user.id, userAgent) };
  },

  /** Rotates the refresh token. Presenting an outdated one (outside the grace window) revokes the session. */
  async refresh(refreshToken: string | undefined): Promise<IssuedTokens> {
    const parsed = refreshToken ? parseRefreshToken(refreshToken) : null;
    if (!parsed) throw sessionExpired();

    const session = await prisma.session.findUnique({
      where: { id: parsed.sessionId },
      include: { user: true },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) {
      throw sessionExpired();
    }

    const presented = hashRefreshSecret(parsed.secret);
    const accessToken = () => signAccessToken({ userId: session.userId, sessionId: session.id });

    if (hashesEqual(presented, session.tokenHash)) {
      const next = createRefreshSecret();
      // Conditional on the hash we checked, so two parallel rotations cannot both win.
      const { count } = await prisma.session.updateMany({
        where: { id: session.id, tokenHash: presented },
        data: {
          tokenHash: next.hash,
          previousTokenHash: presented,
          rotatedAt: now,
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
        },
      });
      if (count === 1) {
        return {
          accessToken: await accessToken(),
          refreshToken: formatRefreshToken(session.id, next.secret),
        };
      }
      // Lost the race to a parallel request: same as presenting the previous token just now.
      return { accessToken: await accessToken(), refreshToken: null };
    }

    const withinGrace =
      session.previousTokenHash !== null &&
      hashesEqual(presented, session.previousTokenHash) &&
      session.rotatedAt !== null &&
      now.getTime() - session.rotatedAt.getTime() < REFRESH_REUSE_GRACE_MS;
    if (withinGrace) return { accessToken: await accessToken(), refreshToken: null };

    // An old token came back: someone may have copied it. End the session for everyone.
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    throw sessionExpired();
  },

  async logout(refreshToken: string | undefined): Promise<void> {
    const parsed = refreshToken ? parseRefreshToken(refreshToken) : null;
    if (!parsed) return;
    const session = await prisma.session.findUnique({ where: { id: parsed.sessionId } });
    if (!session || session.revokedAt) return;

    // Only the holder of the secret may end the session (the id alone is not proof).
    const presented = hashRefreshSecret(parsed.secret);
    const owns =
      hashesEqual(presented, session.tokenHash) ||
      (session.previousTokenHash !== null && hashesEqual(presented, session.previousTokenHash));
    if (owns) {
      await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    }
  },

  async changePassword(auth: AuthContext, body: ChangePasswordBody): Promise<void> {
    if (!(await verifyPassword(body.currentPassword, auth.user.passwordHash))) {
      // 403, not 401: the session is fine, and a 401 would make the client try to refresh.
      throw HttpError.forbidden("Current password is incorrect", "INVALID_CREDENTIALS");
    }
    await prisma.user.update({
      where: { id: auth.user.id },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });
    await revokeSessions(auth.user.id, auth.sessionId);
  },
};
