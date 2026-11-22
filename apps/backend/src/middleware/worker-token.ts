import { createHash, timingSafeEqual } from "node:crypto";

import type { RequestHandler } from "express";

import { env } from "~backend/config/env";
import { HttpError } from "~backend/lib/http-error";

const digest = (value: string) => createHash("sha256").update(value).digest();

// Comparing digests: equal lengths for timingSafeEqual, and the token's length does not leak.
const expected = env.WORKER_TOKEN === undefined ? null : digest(env.WORKER_TOKEN);

/** Machine auth for `/workers/*`: `Authorization: Bearer <WORKER_TOKEN>`. No user session. */
export const requireWorkerToken: RequestHandler = (req, _res, next) => {
  if (expected === null) {
    throw new HttpError(503, "Worker endpoints are disabled: set WORKER_TOKEN");
  }
  const match = /^Bearer (\S+)$/.exec(req.get("authorization") ?? "");
  if (!match || !timingSafeEqual(digest(match[1]), expected)) {
    throw HttpError.unauthorized("Missing or wrong worker token");
  }
  next();
};
