import { ErrorResponseSchema, type ErrorCode } from "@subsurf/contracts/common/common.schema";

export interface ApiError {
  status: number;
  message: string;
  code?: ErrorCode;
  /** What the API attached to the error, e.g. the scan a file was already imported as. */
  details?: unknown;
}

/** The `ErrorResponse` body that openapi-react-query throws for non-2xx responses, if it is one. */
export function toApiError(error: unknown): ApiError | null {
  const parsed = ErrorResponseSchema.safeParse(error);
  return parsed.success ? parsed.data.error : null;
}

export function isUnauthenticated(error: unknown): boolean {
  return toApiError(error)?.status === 401;
}
