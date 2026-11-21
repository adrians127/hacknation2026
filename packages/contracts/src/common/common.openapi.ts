import { registry } from "../../scripts/registry";
import { ErrorResponseSchema } from "./common.schema";

// Use the returned schema: only that instance carries the $ref metadata.
const ErrorResponse = registry.register("ErrorResponse", ErrorResponseSchema);

/** The access-token cookie set by `POST /auth/login` (scheme registered in generate-openapi.ts). */
export const cookieAuth = [{ cookieAuth: [] }];

export function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: ErrorResponse } },
  };
}

export const unauthenticated = errorResponse("Not signed in, or the session expired");
export const forbidden = errorResponse(
  "Missing permission, or the user must change their password first",
);
export const validationFailed = errorResponse("Validation failed");
export const notFound = errorResponse("Not found");
