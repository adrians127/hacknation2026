import type { RequestHandler } from "express";

import { env } from "~backend/config/env";
import { HttpError } from "~backend/lib/http-error";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isSameOrigin(origin: string, host: string | undefined): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * CSRF defense on top of SameSite cookies: a state-changing request whose
 * browser-set `Origin` is neither the frontend nor the API itself (Swagger UI)
 * is refused. No `Origin` means no browser (curl, tests), which cannot ride a session.
 */
export const trustedOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get("origin");
  if (
    !SAFE_METHODS.has(req.method) &&
    origin !== undefined &&
    origin !== env.CORS_ORIGIN &&
    !isSameOrigin(origin, req.get("host"))
  ) {
    throw HttpError.forbidden("Untrusted origin", "UNTRUSTED_ORIGIN");
  }
  next();
};
