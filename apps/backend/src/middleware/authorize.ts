import type { RequestHandler } from "express";

import type { Permission } from "@subsurf/contracts/auth/permissions";

import { getAuth } from "~backend/lib/auth-context";
import { HttpError } from "~backend/lib/http-error";

/** 403 unless the caller holds every listed permission. Runs after `requireAuth`. */
export function requirePermission(...required: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const { permissions } = getAuth(req);
    const missing = required.filter((permission) => !permissions.includes(permission));
    if (missing.length > 0) {
      throw HttpError.forbidden(`Missing permission: ${missing.join(", ")}`);
    }
    next();
  };
}
