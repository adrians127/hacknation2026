import { z } from "zod";

import { NonBlankStringSchema } from "../common/common.schema";
import { QueuedScanSchema } from "../scans/scans.schema";
import {
  collectTargets,
  isTargetWarning,
  TARGET_IMPORT_LIMITS,
  TargetKindSchema,
  type TargetKind,
} from "./target-input";

// Defined next to the parser that classifies targets; re-exported for the API types.
export { TargetKindSchema, type TargetKind };

export const TargetSchema = z.object({
  id: z.uuid(),
  kind: TargetKindSchema,
  value: z.string(),
  note: z.string(),
  tags: z.array(z.string()),
  activeHosts: z.number().int().nonnegative(),
  lastScanAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const TargetListResponseSchema = z.object({ items: z.array(TargetSchema) });

const NoteSchema = z.string().max(TARGET_IMPORT_LIMITS.maxNoteLength);
const TagsSchema = z.array(NonBlankStringSchema.max(50)).max(20);

export const UpdateTargetBodySchema = z
  .object({
    note: NoteSchema.optional(),
    tags: TagsSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

// Enough to point at the problem without a 100k-issue error response.
const MAX_REPORTED_ISSUES = 100;

/**
 * Raw values are accepted (URLs, CIDRs with host bits, repeats): the backend normalizes and
 * deduplicates them with the same parser the form's preview uses. Rejected entries fail the request.
 */
export const ImportTargetsBodySchema = z
  .object({
    entries: z
      .array(
        z.object({
          value: NonBlankStringSchema.max(TARGET_IMPORT_LIMITS.maxRawValueLength),
          note: NoteSchema.optional(),
        }),
      )
      .min(1)
      .max(TARGET_IMPORT_LIMITS.maxEntries),
    /** Also queue a scan of every entry of this import (requires `scans:run`). */
    startScan: z.boolean(),
  })
  .superRefine(({ entries }, ctx) => {
    const { issues, listErrors } = collectTargets(
      entries.map((entry, index) => ({ position: index, value: entry.value, note: entry.note ?? "" })),
    );
    const errors = issues.filter((issue) => !isTargetWarning(issue.code));
    for (const issue of errors.slice(0, MAX_REPORTED_ISSUES)) {
      ctx.addIssue({ code: "custom", path: ["entries", issue.position], message: issue.code });
    }
    for (const code of listErrors) ctx.addIssue({ code: "custom", path: ["entries"], message: code });
  });

export const ImportWarningCodeSchema = z.enum([
  "dns_not_found",
  "dns_no_addresses",
  "dns_timeout",
  "dns_failed",
  "resolves_to_reserved",
  "no_scannable_targets",
]);

export const ImportWarningSchema = z.object({
  code: ImportWarningCodeSchema,
  /** The domain concerned; empty for `no_scannable_targets`. */
  value: z.string(),
});

export const ImportTargetsResponseSchema = z.object({
  /** Unique entries after normalization. */
  received: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  /** Already in the inventory, left unchanged. */
  skipped: z.number().int().nonnegative(),
  /** `null` without `startScan`, or when nothing was scannable (see `warnings`). */
  scan: QueuedScanSchema.nullable(),
  warnings: z.array(ImportWarningSchema),
});

export type Target = z.infer<typeof TargetSchema>;
export type TargetListResponse = z.infer<typeof TargetListResponseSchema>;
export type UpdateTargetBody = z.infer<typeof UpdateTargetBodySchema>;
export type ImportTargetsBody = z.infer<typeof ImportTargetsBodySchema>;
export type ImportWarningCode = z.infer<typeof ImportWarningCodeSchema>;
export type ImportWarning = z.infer<typeof ImportWarningSchema>;
export type ImportTargetsResponse = z.infer<typeof ImportTargetsResponseSchema>;
