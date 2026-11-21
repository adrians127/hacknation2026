import { z } from "zod";

/**
 * A string with at least one non-whitespace character. A pattern rather than
 * `.trim().min(1)`: `.trim()` is a transform, and the backend's `validate()`
 * parses without reassigning `req.body`, so the trimmed value would be lost.
 */
export const NonBlankStringSchema = z.string().min(1).regex(/\S/, "Must not be blank");

/** User-assigned labels on inventory items (targets, hosts, services). */
export const TagsSchema = z.array(NonBlankStringSchema.max(50)).max(20);

/** Machine-readable reason, so the frontend can tell 401/403/409 cases apart and translate them. */
export const ErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "PASSWORD_CHANGE_REQUIRED",
  "FORBIDDEN",
  "UNTRUSTED_ORIGIN",
  "PERMISSION_ESCALATION",
  "SELF_MODIFICATION",
  "LAST_ADMIN",
  "SYSTEM_ROLE_READ_ONLY",
  "ROLE_IN_USE",
  "EMAIL_TAKEN",
  "ROLE_NAME_TAKEN",
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Error envelope every non-2xx JSON response uses (see backend error-handler). */
export const ErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    status: z.number().int(),
    code: ErrorCodeSchema.optional(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const IdParamsSchema = z.object({ id: z.uuid() });

export type IdParams = z.infer<typeof IdParamsSchema>;
