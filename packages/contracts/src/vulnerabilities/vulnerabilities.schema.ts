import { z } from "zod";

import { AssetNoteSchema } from "../hosts/hosts.schema";

const CountSchema = z.number().int().nonnegative();
const TimestampSchema = z.iso.datetime();

export const VulnerabilitySeveritySchema = z.enum([
  "critical",
  "high",
  "medium",
  "low",
  "none",
  "unknown",
]);

/** `potential`: the service may be affected, but the evidence is incomplete (see the reasons). */
export const MatchConfidenceSchema = z.enum(["confirmed", "potential"]);

export const MatchReasonSchema = z.enum([
  /** The scanner reported the product without a usable version. */
  "version_unknown",
  /** A distribution package: the vendor may have backported the fix without a version bump. */
  "distro_backport_possible",
  /** The distribution's own data says this package revision is fixed. */
  "fixed_by_backport",
  /** Affected only on a platform the scan could not confirm. */
  "platform_condition",
]);

export const MatchStatusSchema = z.enum(["active", "retracted"]);

export const RetractReasonSchema = z.enum([
  /** The source rejected or withdrew the record, or it disappeared from the source. */
  "source_withdrawn",
  /** The record's affected versions changed and no longer cover the service. */
  "criteria_changed",
  /** A later scan saw another product or version. */
  "service_changed",
  "source_disabled",
]);

/** An analyst's verdict on one vulnerability of one service; never set by a sync. */
export const VulnerabilityTriageStatusSchema = z.enum([
  "unreviewed",
  "important",
  "accepted_risk",
  "false_positive",
]);

export const VerdictSchema = z.enum(["affected", "not_affected", "unknown"]);

/** Counted per vulnerability (CVE), not per source record; false positives are left out. */
export const VulnerabilitySummarySchema = z.object({
  confirmed: CountSchema,
  potential: CountSchema,
  /** Confirmed ones in the CISA Known Exploited Vulnerabilities catalog. */
  kev: CountSchema,
  /** Highest severity among the confirmed ones; `null` without any. */
  maxSeverity: VulnerabilitySeveritySchema.nullable(),
});

export const VulnerabilityEvidenceSchema = z.object({
  sourceId: z.string(),
  externalId: z.string(),
  /** The record on the source's website. */
  url: z.url(),
  verdict: VerdictSchema,
});

/** One vulnerability of a service, merged across sources by its canonical (CVE) id. */
export const ServiceVulnerabilitySchema = z.object({
  /** CVE id when the vulnerability has one, otherwise the source's own id. */
  canonicalId: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  severity: VulnerabilitySeveritySchema,
  cvssScore: z.number().nullable(),
  cvssVector: z.string().nullable(),
  /** In the CISA KEV catalog since this date. */
  kevAddedAt: TimestampSchema.nullable(),
  publishedAt: TimestampSchema.nullable(),
  confidence: MatchConfidenceSchema,
  reasons: z.array(MatchReasonSchema),
  status: MatchStatusSchema,
  retractReason: RetractReasonSchema.nullable(),
  retractedAt: TimestampSchema.nullable(),
  firstMatchedAt: TimestampSchema,
  lastEvaluatedAt: TimestampSchema,
  /** What the match was evaluated on: the service's newest observation. */
  basis: z.object({
    scanId: z.uuid().nullable(),
    cpe: z.string().nullable(),
    version: z.string().nullable(),
  }),
  evidence: z.array(VulnerabilityEvidenceSchema),
  references: z.array(z.url()),
  triage: VulnerabilityTriageStatusSchema,
  note: z.string(),
});

export const SyncModeSchema = z.enum(["incremental", "full"]);
export const SyncTriggerSchema = z.enum(["schedule", "manual", "cli"]);
export const SyncRunStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);

export const SyncRunStatsSchema = z.object({
  upserted: CountSchema,
  unchanged: CountSchema,
  withdrawn: CountSchema,
  swept: CountSchema,
  matchesAdded: CountSchema,
  matchesRetracted: CountSchema,
  matchesReactivated: CountSchema,
});

export const SyncRunSchema = z.object({
  id: z.uuid(),
  sourceId: z.string(),
  mode: SyncModeSchema,
  trigger: SyncTriggerSchema,
  status: SyncRunStatusSchema,
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.nullable(),
  stats: SyncRunStatsSchema,
  error: z.string().nullable(),
});

export const JobRequestKindSchema = z.enum(["sync", "full_sync", "rematch"]);

export const JobRequestSchema = z.object({
  id: z.uuid(),
  kind: JobRequestKindSchema,
  sourceId: z.string().nullable(),
  createdAt: TimestampSchema,
});

export const VulnerabilitySourceSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  enabled: z.boolean(),
  /** Where the source downloads from (a mirror directory in offline mode). */
  baseUrl: z.string(),
  /** Parts of the source that are synced separately (OSV ecosystems); empty for NVD. */
  scopes: z.array(z.string()),
  /** Active records (not rejected or withdrawn). */
  recordCount: CountSchema,
  lastIncrementalAt: TimestampSchema.nullable(),
  lastFullAt: TimestampSchema.nullable(),
  lastSuccessAt: TimestampSchema.nullable(),
  lastError: z.string().nullable(),
  /** When the sync process will next run each mode, if it is running. */
  nextIncrementalAt: TimestampSchema.nullable(),
  nextFullAt: TimestampSchema.nullable(),
  running: SyncRunSchema.nullable(),
  pendingRequest: JobRequestSchema.nullable(),
});

export const VulnerabilitySourceListResponseSchema = z.object({
  items: z.array(VulnerabilitySourceSchema),
  /** Whether a sync process holds the lease right now (`pnpm vulns:sync`). */
  syncProcessActive: z.boolean(),
});

export const SourceParamsSchema = z.object({ id: z.string().regex(/^[a-z0-9-]{1,32}$/) });

export const RequestSyncBodySchema = z.object({ mode: SyncModeSchema });

export const UpdateSourceBodySchema = z.object({ enabled: z.boolean() });

export const SyncRunListResponseSchema = z.object({ items: z.array(SyncRunSchema) });

// CPE components as NVD writes them: lowercase, `_` for spaces.
const CpeNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_.\-+]*$/, "Lowercase CPE name, e.g. openbsd or http_server");

/** Which package a CPE product is in a package ecosystem (the `package` matcher's lookup). */
export const PackageMappingSchema = z.object({
  id: z.uuid(),
  cpeVendor: z.string(),
  cpeProduct: z.string(),
  ecosystem: z.string(),
  packageName: z.string(),
  createdAt: TimestampSchema,
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
});

export const PackageMappingListResponseSchema = z.object({
  items: z.array(PackageMappingSchema),
  /** The ecosystems the package sources sync, for the form. */
  ecosystems: z.array(z.string()),
});

export const CreatePackageMappingBodySchema = z.object({
  cpeVendor: CpeNameSchema,
  cpeProduct: CpeNameSchema,
  ecosystem: z.string().min(1).max(50).regex(/^[A-Za-z][A-Za-z0-9.]*$/),
  packageName: z.string().min(1).max(200).regex(/^\S+$/, "No spaces"),
});

export const ServiceVulnerabilityParamsSchema = z.object({
  serviceId: z.uuid(),
  canonicalId: z.string().regex(/^[A-Za-z0-9:_.-]{1,100}$/),
});

export const UpdateServiceVulnerabilityBodySchema = z
  .object({
    triage: VulnerabilityTriageStatusSchema.optional(),
    note: AssetNoteSchema.optional(),
  })
  .refine((body) => body.triage !== undefined || body.note !== undefined, {
    message: "Provide at least one field to update",
  });

export const ServiceVulnerabilityTriageSchema = z.object({
  serviceId: z.uuid(),
  canonicalId: z.string(),
  triage: VulnerabilityTriageStatusSchema,
  note: z.string(),
});

/** Host list filter: confirmed, active vulnerabilities that are not false positives. */
export const VulnerabilityFilterSchema = z.enum(["any", "critical", "high", "kev"]);

export type VulnerabilitySeverity = z.infer<typeof VulnerabilitySeveritySchema>;
export type MatchConfidence = z.infer<typeof MatchConfidenceSchema>;
export type MatchReason = z.infer<typeof MatchReasonSchema>;
export type MatchStatus = z.infer<typeof MatchStatusSchema>;
export type RetractReason = z.infer<typeof RetractReasonSchema>;
export type VulnerabilityTriageStatus = z.infer<typeof VulnerabilityTriageStatusSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type VulnerabilitySummary = z.infer<typeof VulnerabilitySummarySchema>;
export type VulnerabilityEvidence = z.infer<typeof VulnerabilityEvidenceSchema>;
export type ServiceVulnerability = z.infer<typeof ServiceVulnerabilitySchema>;
export type SyncMode = z.infer<typeof SyncModeSchema>;
export type SyncTrigger = z.infer<typeof SyncTriggerSchema>;
export type SyncRunStatus = z.infer<typeof SyncRunStatusSchema>;
export type SyncRunStats = z.infer<typeof SyncRunStatsSchema>;
export type SyncRun = z.infer<typeof SyncRunSchema>;
export type JobRequestKind = z.infer<typeof JobRequestKindSchema>;
export type JobRequest = z.infer<typeof JobRequestSchema>;
export type VulnerabilitySource = z.infer<typeof VulnerabilitySourceSchema>;
export type VulnerabilitySourceListResponse = z.infer<typeof VulnerabilitySourceListResponseSchema>;
export type SourceParams = z.infer<typeof SourceParamsSchema>;
export type RequestSyncBody = z.infer<typeof RequestSyncBodySchema>;
export type UpdateSourceBody = z.infer<typeof UpdateSourceBodySchema>;
export type SyncRunListResponse = z.infer<typeof SyncRunListResponseSchema>;
export type PackageMapping = z.infer<typeof PackageMappingSchema>;
export type PackageMappingListResponse = z.infer<typeof PackageMappingListResponseSchema>;
export type CreatePackageMappingBody = z.infer<typeof CreatePackageMappingBodySchema>;
export type ServiceVulnerabilityParams = z.infer<typeof ServiceVulnerabilityParamsSchema>;
export type UpdateServiceVulnerabilityBody = z.infer<typeof UpdateServiceVulnerabilityBodySchema>;
export type ServiceVulnerabilityTriage = z.infer<typeof ServiceVulnerabilityTriageSchema>;
export type VulnerabilityFilter = z.infer<typeof VulnerabilityFilterSchema>;
