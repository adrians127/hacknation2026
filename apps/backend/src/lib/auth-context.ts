import {
  isPermission,
  PERMISSIONS,
  type Permission,
} from "@hacknation/contracts/auth/permissions";

import type { Role, User } from "~backend/generated/prisma/client";
import { HttpError } from "~backend/lib/http-error";

export interface AuthContext {
  user: User;
  role: Role;
  permissions: Permission[];
  sessionId: string;
}

/** The caller set by `requireAuth`. Reaching this without it is a route wiring bug. */
export function getAuth(req: { auth?: AuthContext }): AuthContext {
  if (!req.auth) throw HttpError.unauthorized("No authenticated user on this request");
  return req.auth;
}

/** Known permissions only (stale ones are ignored), deduplicated, in catalog order. */
export function toPermissions(raw: readonly string[]): Permission[] {
  const held = new Set(raw.filter(isPermission));
  return PERMISSIONS.filter((permission) => held.has(permission));
}

/** Nobody can hand out (or manage someone holding) permissions they do not hold themselves. */
export function assertHoldsAll(auth: AuthContext, permissions: readonly string[]): void {
  const missing = toPermissions(permissions).filter((p) => !auth.permissions.includes(p));
  if (missing.length > 0) {
    throw HttpError.forbidden(
      `You cannot grant or manage permissions you do not hold: ${missing.join(", ")}`,
      "PERMISSION_ESCALATION",
    );
  }
}
