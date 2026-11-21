import { z } from "zod";

/**
 * A string with at least one non-whitespace character. A pattern rather than
 * `.trim().min(1)`: `.trim()` is a transform, and the backend's `validate()`
 * parses without reassigning `req.body`, so the trimmed value would be lost.
 */
export const NonBlankStringSchema = z.string().min(1).regex(/\S/, "Must not be blank");

/** Error envelope every non-2xx JSON response uses (see backend error-handler). */
export const ErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    status: z.number().int(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
