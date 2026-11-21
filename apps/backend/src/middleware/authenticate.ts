import type { RequestHandler } from "express";

import { ACCESS_COOKIE, readCookie } from "~backend/lib/auth-cookies";
import { toPermissions } from "~backend/lib/auth-context";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { verifyAccessToken } from "~backend/lib/tokens";

function authenticate({ allowPendingPasswordChange }: { allowPendingPasswordChange: boolean }) {
  const handler: RequestHandler = async (req, _res, next) => {
    const token = readCookie(req.cookies, ACCESS_COOKIE);
    const claims = token ? await verifyAccessToken(token) : null;
    if (!claims) throw HttpError.unauthorized("Not signed in");

    // One query per request on purpose: role changes, deactivation and logout apply immediately.
    const session = await prisma.session.findUnique({
      where: { id: claims.sessionId },
      include: { user: { include: { role: true } } },
    });
    if (
      !session ||
      session.userId !== claims.userId ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    ) {
      throw HttpError.unauthorized("Session expired");
    }

    const { user } = session;
    if (user.mustChangePassword && !allowPendingPasswordChange) {
      throw HttpError.forbidden("Change your password first", "PASSWORD_CHANGE_REQUIRED");
    }

    req.auth = {
      user,
      role: user.role,
      permissions: toPermissions(user.role.permissions),
      sessionId: session.id,
    };
    next();
  };
  return handler;
}

/** Signed in, active session, no pending forced password change. Put before `requirePermission`. */
export const requireAuth = authenticate({ allowPendingPasswordChange: false });

/** Signed in, even while a temporary password still has to be changed (`/auth/me`, change-password). */
export const requireSession = authenticate({ allowPendingPasswordChange: true });
