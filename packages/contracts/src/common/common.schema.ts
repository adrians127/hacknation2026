import { z } from "zod";

/**
 * A string with at least one non-whitespace character. A pattern rather than
 * `.trim().min(1)`: `.trim()` is a transform, and the backend's `validate()`
 * parses without reassigning `req.body`, so the trimmed value would be lost.
 */
export const NonBlankStringSchema = z.string().min(1).regex(/\S/, "Must not be blank");

/** One user-assigned label on an inventory item (target, host, service). */
export const TagSchema = NonBlankStringSchema.max(50);

/** Most tags one item may carry; bulk tagging skips items already at the limit. */
export const MAX_TAGS = 20;

export const TagsSchema = z.array(TagSchema).max(MAX_TAGS);

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
  "PACKAGE_MAPPING_EXISTS",
  "SOURCE_DISABLED",
  "BASE_SCAN_NOT_OLDER",
  "DEFECTDOJO_NOT_CONFIGURED",
  "DEFECTDOJO_UNAVAILABLE",
  "DEFECTDOJO_SYNC_RUNNING",
  "DEFECTDOJO_PUSH_RUNNING",
  "NOTHING_TO_PUSH",
  "SCAN_IMPORT_INVALID",
  "SCAN_ALREADY_IMPORTED",
  "SCAN_IMPORT_RUNNING",
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
