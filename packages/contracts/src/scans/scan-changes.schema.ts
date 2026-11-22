import { z } from "zod";

import {
  FieldChangeKindSchema,
  FieldChangeSchema,
  HostLifecycleSchema,
  ScanChangeSchema,
  ScanCompareQuerySchema,
} from "./scan-results.schema";

/** How urgently a change deserves a look (PDF: "ocena ciekawości lub priorytetu"). */
export const ChangePrioritySchema = z.enum(["high", "medium", "low"]);

/** Why a change got its priority; one per row (`change-priority.ts` in the backend). */
export const ChangeReasonSchema = z.enum([
  "new-host",
  "returning-host",
  "risky-port",
  "new-service",
  "admin-panel",
  "ssh-key-changed",
  "self-signed",
  "version-change",
  "new-endpoint",
  "page-change",
  "cert-change",
  "security-header-removed",
  "cookie-flags-weakened",
  "technology-header",
  "host-inactive",
  "host-gone",
  "service-gone",
  "no-answer",
  "other",
]);

/**
 * One change between two scans:
 * - a host row (`port: null`, `field: null`): the host is new, gone or unknown; `before` and
 *   `after` are the statuses the two scans got;
 * - a service row (`field: null`): a port opened or closed; `before`/`after` name the service;
 * - a field row: one `FieldChange` of a changed service, or a hostname of a changed host.
 */
export const ScanChangeRowSchema = z.object({
  hostId: z.uuid(),
  ip: z.ipv4(),
  hostnames: z.array(z.string()),
  protocol: z.literal("tcp").nullable(),
  port: z.number().int().nullable(),
  change: ScanChangeSchema,
  field: FieldChangeKindSchema.nullable(),
  endpoint: FieldChangeSchema.shape.endpoint,
  key: z.string().nullable(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  priority: ChangePrioritySchema,
  reason: ChangeReasonSchema,
  /** The host's lifecycle as of the compared scan. */
  lifecycle: HostLifecycleSchema,
});

export const ScanChangesQuerySchema = ScanCompareQuerySchema.extend({
  format: z.enum(["json", "csv"]).default("json"),
});

const ScanRefSchema = z.object({ id: z.uuid(), startedAt: z.iso.datetime().nullable() });

export const ScanChangesResponseSchema = z.object({
  scan: ScanRefSchema,
  /** `null` for the first scan: nothing to compare with, so no rows. */
  baseScan: ScanRefSchema.nullable(),
  items: z.array(ScanChangeRowSchema),
});

export type ChangePriority = z.infer<typeof ChangePrioritySchema>;
export type ChangeReason = z.infer<typeof ChangeReasonSchema>;
export type ScanChangeRow = z.infer<typeof ScanChangeRowSchema>;
export type ScanChangesQuery = z.infer<typeof ScanChangesQuerySchema>;
export type ScanChangesResponse = z.infer<typeof ScanChangesResponseSchema>;
