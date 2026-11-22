import type { ErrorCode } from "@subsurf/contracts/common/common.schema";

export interface HttpErrorOptions extends ErrorOptions {
  /** Machine-readable reason, sent as `error.code` so the frontend can translate it. */
  code?: ErrorCode;
  /** Sent as `error.details`: what the client needs to act on the error. Never internals. */
  details?: unknown;
}

/**
 * Error carrying an HTTP status. Throw it from controllers/services; the central
 * error handler turns it into a response. Anything else thrown becomes a 500.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  readonly details: unknown;

  constructor(status: number, message: string, options: HttpErrorOptions = {}) {
    super(message, options);
    this.name = "HttpError";
    this.status = status;
    this.code = options.code;
    this.details = options.details;
  }

  static badRequest(message = "Bad Request", code?: ErrorCode) {
    return new HttpError(400, message, { code });
  }

  static unauthorized(message = "Unauthorized", code: ErrorCode = "UNAUTHENTICATED") {
    return new HttpError(401, message, { code });
  }

  static forbidden(message = "Forbidden", code: ErrorCode = "FORBIDDEN") {
    return new HttpError(403, message, { code });
  }

  static notFound(message = "Not Found") {
    return new HttpError(404, message);
  }

  static conflict(message = "Conflict", code?: ErrorCode) {
    return new HttpError(409, message, { code });
  }
}
