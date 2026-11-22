import { z } from "zod";

import { ScanJobKindSchema, ScanJobStatusSchema, type ScanJobStatus } from "./scans.schema";

const CountSchema = z.number().int().nonnegative();

export const ScanJobCountsSchema = z.object({
  queued: CountSchema,
  leased: CountSchema,
  completed: CountSchema,
  failed: CountSchema,
  stopped: CountSchema,
}) satisfies z.ZodType<Record<ScanJobStatus, number>>;

/** One step of the pipeline a scan ran, and its jobs so far. */
export const ScanStepSchema = z.object({
  index: z.number().int().positive(),
  worker: z.string(),
  input: z.enum(["targets", "previous"]),
  ports: z.string(),
  rate: z.number().int().nonnegative(),
  jobs: ScanJobCountsSchema,
});

export const ScanJobSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int().positive(),
  stepIndex: z.number().int().positive(),
  worker: z.string(),
  kind: ScanJobKindSchema,
  status: ScanJobStatusSchema,
  subnet: z.string(),
  addressCount: CountSchema,
  attempts: CountSchema,
  /** worker-manager holding (or last holding) the lease. */
  leasedBy: z.string().nullable(),
  leaseExpiresAt: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  durationMs: CountSchema.nullable(),
  /** Worker results stored for the job (one per task of a split job). */
  resultCount: CountSchema,
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});

export const SCAN_JOBS_PAGE_SIZE_MAX = 200;

export const ScanJobListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(SCAN_JOBS_PAGE_SIZE_MAX).default(50),
  step: z.coerce.number().int().min(1).optional(),
  status: ScanJobStatusSchema.optional(),
});

export const ScanJobListResponseSchema = z.object({
  items: z.array(ScanJobSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: CountSchema,
});

export type ScanJobCounts = z.infer<typeof ScanJobCountsSchema>;
export type ScanStep = z.infer<typeof ScanStepSchema>;
export type ScanJob = z.infer<typeof ScanJobSchema>;
export type ScanJobListQuery = z.infer<typeof ScanJobListQuerySchema>;
export type ScanJobListResponse = z.infer<typeof ScanJobListResponseSchema>;
