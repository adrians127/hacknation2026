import type { ErrorRequestHandler } from "express";
import { z, ZodError } from "zod";

import type { ErrorResponse } from "@hacknation/contracts/common/common.schema";

import { isDevelopment } from "~backend/config/env";
import { HttpError } from "~backend/lib/http-error";

/** Our `HttpError`, or any library error carrying a numeric `status`/`statusCode`. Else 500. */
function statusFromError(err: unknown): number {
  if (err instanceof HttpError) return err.status;
  if (typeof err === "object" && err !== null) {
    const e = err as { status?: unknown; statusCode?: unknown };
    if (typeof e.status === "number") return e.status;
    if (typeof e.statusCode === "number") return e.statusCode;
  }
  return 500;
}

/**
 * Central error handler, mounted last. Express 5 forwards rejected promises from
 * async handlers here, so controllers can simply `throw`.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const body: ErrorResponse = {
      error: { message: "Validation failed", status: 400, details: z.flattenError(err) },
    };
    res.status(400).json(body);
    return;
  }

  const status = statusFromError(err);
  const message = err instanceof Error ? err.message : "Internal Server Error";

  if (status >= 500) {
    req.log.error({ err }, "Unhandled error");
  }

  const body: ErrorResponse & { error: { stack?: string } } = {
    error: {
      // 5xx messages may leak internals; only show them on a laptop.
      message: status >= 500 && !isDevelopment ? "Internal Server Error" : message,
      status,
      ...(isDevelopment && err instanceof Error ? { stack: err.stack } : {}),
    },
  };
  res.status(status).json(body);
};
