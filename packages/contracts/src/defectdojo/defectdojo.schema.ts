import { z } from "zod";

const CountSchema = z.number().int().nonnegative();

export const DefectDojoSyncStatusSchema = z.enum(["running", "succeeded", "failed"]);

/** What one pull from DefectDojo changed in SubSurf. */
export const DefectDojoSyncStatsSchema = z.object({
  products: CountSchema,
  findings: CountSchema,
  /** Findings whose host:port is a known service. */
  matchedFindings: CountSchema,
  /** Findings without an address, or for an address or port SubSurf has never seen open. */
  unmatchedFindings: CountSchema,
  hostsUpdated: CountSchema,
  servicesUpdated: CountSchema,
  tagsAdded: CountSchema,
  /** Tags dropped because the asset already had the maximum number of tags. */
  tagsSkipped: CountSchema,
  triageSet: CountSchema,
  remediationUpdated: CountSchema,
});

export const DefectDojoSyncSchema = z.object({
  id: z.uuid(),
  status: DefectDojoSyncStatusSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  startedBy: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  /** `null` until the sync finishes, and for a failed one. */
  stats: DefectDojoSyncStatsSchema.nullable(),
  error: z.string().nullable(),
});

/** Reimport counts DefectDojo reports for one push. */
export const DefectDojoPushStatsSchema = z.object({
  created: CountSchema,
  closed: CountSchema,
  reactivated: CountSchema,
  untouched: CountSchema,
});

export const DEFECTDOJO_PUSH_SELECTION_MAX = 10_000;

/**
 * Without `hostIds` and `serviceIds`: the whole scan, and findings of services the scan no
 * longer sees are closed in DefectDojo. With them: only those services, nothing is closed.
 */
export const DefectDojoPushBodySchema = z.object({
  scanId: z.uuid(),
  hostIds: z.array(z.uuid()).max(DEFECTDOJO_PUSH_SELECTION_MAX).optional(),
  serviceIds: z.array(z.uuid()).max(DEFECTDOJO_PUSH_SELECTION_MAX).optional(),
});

export const DefectDojoPushScopeSchema = z.enum(["scan", "selection"]);

export const DefectDojoPushSchema = z.object({
  id: z.uuid(),
  scanId: z.uuid(),
  scope: DefectDojoPushScopeSchema,
  status: DefectDojoSyncStatusSchema,
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  startedBy: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  /** Findings in the uploaded report: one per service. */
  findings: CountSchema,
  /** The DefectDojo test the report went into. */
  testId: z.number().int().nullable(),
  stats: DefectDojoPushStatsSchema.nullable(),
  error: z.string().nullable(),
});

export const DefectDojoStatusSchema = z.object({
  /** `false` without `DEFECTDOJO_URL` and `DEFECTDOJO_API_TOKEN`. */
  configured: z.boolean(),
  url: z.url().nullable(),
  lastSync: DefectDojoSyncSchema.nullable(),
  lastPush: DefectDojoPushSchema.nullable(),
});

/**
 * Dates DefectDojo tracks for the findings on a service (`YYYY-MM-DD`), the earliest of each.
 * Imported by the sync and replaced by the next one; users do not edit them.
 */
export const ServiceRemediationSchema = z.object({
  plannedOn: z.iso.date().nullable(),
  slaDueOn: z.iso.date().nullable(),
  riskAcceptedUntil: z.iso.date().nullable(),
});

export type DefectDojoSyncStatus = z.infer<typeof DefectDojoSyncStatusSchema>;
export type DefectDojoSyncStats = z.infer<typeof DefectDojoSyncStatsSchema>;
export type DefectDojoSync = z.infer<typeof DefectDojoSyncSchema>;
export type DefectDojoStatus = z.infer<typeof DefectDojoStatusSchema>;
export type ServiceRemediation = z.infer<typeof ServiceRemediationSchema>;
export type DefectDojoPushStats = z.infer<typeof DefectDojoPushStatsSchema>;
export type DefectDojoPushBody = z.infer<typeof DefectDojoPushBodySchema>;
export type DefectDojoPushScope = z.infer<typeof DefectDojoPushScopeSchema>;
export type DefectDojoPush = z.infer<typeof DefectDojoPushSchema>;
