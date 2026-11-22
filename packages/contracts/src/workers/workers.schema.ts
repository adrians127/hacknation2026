import { z } from "zod";

import { SplitStrategySchema, WorkerNameSchema } from "./worker-catalog";
import { WorkerResultSchema } from "./worker-result.schema";

const TcpPortSchema = z.number().int().min(1).max(65535);
const UtcSecondsSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

export const NmapTargetSchema = z.object({
  ip: z.ipv4(),
  domains: z.array(z.string().min(1).max(253)).max(128).optional(),
  /** Legacy single domain; use domains for new jobs. */
  domain: z.string().min(1).max(253).nullable().optional(),
  tcp_ports: z.array(TcpPortSchema).min(1).max(4096),
});

export const NmapJobSchema = z.object({
  job_id: z.uuid(),
  lease_id: z.string().min(1).max(256),
  scan_id: z.uuid(),
  subnet: z.cidrv4(),
  deadline: UtcSecondsSchema,
  limits: z
    .object({
      max_parallel: z.number().int().positive().optional(),
      max_rate_per_process: z.number().int().positive().optional(),
      host_timeout_ms: z.number().int().positive().optional(),
      http_timeout_ms: z.number().int().positive().optional(),
      max_body_bytes: z.number().int().positive().optional(),
      max_redirects: z.number().int().nonnegative().optional(),
    })
    .optional(),
  probe_paths: z
    .array(z.string().startsWith("/").max(2048).refine((path) => !path.startsWith("//")))
    .max(128)
    .optional(),
  targets: z.array(NmapTargetSchema).min(1).max(1024),
});

export const NmapLeaseRequestSchema = z.object({});

export const NmapHeartbeatSchema = z.object({
  job_id: z.string().min(1).max(256),
  lease_id: z.string().min(1).max(256),
});

export type NmapJob = z.infer<typeof NmapJobSchema>;

/** worker-manager splits a job into at most this many tasks (WORKER_MANAGER_MAX_TASKS_PER_JOB). */
const MAX_TASKS_PER_JOB = 1024;

/**
 * One worker run's result. worker-manager may split a leased job into tasks: each task is one
 * worker run and is uploaded on its own, so one lease can have several results.
 */
export const ManagerResultUploadSchema = z
  .object({
    task_index: z.number().int().min(1).max(MAX_TASKS_PER_JOB),
    task_count: z.number().int().min(1).max(MAX_TASKS_PER_JOB),
    result: WorkerResultSchema,
  })
  .refine((upload) => upload.task_index <= upload.task_count, {
    message: "task_index must not exceed task_count",
    path: ["task_index"],
  });

export const ManagerResultUploadResponseSchema = z.object({
  /** `duplicate`: this lease and task were stored before; nothing was written. */
  status: z.enum(["ingested", "duplicate"]),
  resultId: z.uuid(),
});

export type ManagerResultUpload = z.infer<typeof ManagerResultUploadSchema>;
export type ManagerResultUploadResponse = z.infer<typeof ManagerResultUploadResponseSchema>;

/** worker-manager's lease request (its README, "Poll mode"). Unknown fields are ignored. */
export const ManagerLeaseRequestSchema = z.object({
  manager_id: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  version: z.string().max(64),
  /** Workers whose binary the manager has: it is only handed jobs for these. */
  workers: z.array(WorkerNameSchema).max(64),
  max_parallel: z.number().int().min(1).max(1024),
  /** How long the backend may hold the request when there is no work (long poll). */
  wait_seconds: z.number().int().min(0).max(300).optional(),
});

/** One leased `ScanJob`, as an entry of worker-manager's job list (its README, "Input"). */
export const ManagerJobSchema = z.object({
  job_id: z.uuid(),
  scan_id: z.uuid(),
  lease_id: z.uuid(),
  lease_expires_at: UtcSecondsSchema,
  /** The job's time window: tasks get `max_duration_seconds` from it. */
  deadline: UtcSecondsSchema,
  worker: WorkerNameSchema,
  split: z.object({
    strategy: SplitStrategySchema,
    max_tasks: z.number().int().positive().optional(),
    max_items_per_task: z.number().int().positive().optional(),
  }),
  /** The worker's job: `targets`, `ports`, `rate`, `max_duration_seconds` and its own fields. */
  params: z.record(z.string(), z.unknown()),
});

export const ManagerJobListSchema = z.object({
  schema_version: z.literal(1),
  server_time: UtcSecondsSchema,
  /** How long the manager waits before its next lease request. */
  next_poll_ms: z.number().int().nonnegative(),
  jobs: z.array(ManagerJobSchema),
});

export type ManagerLeaseRequest = z.infer<typeof ManagerLeaseRequestSchema>;
export type ManagerJob = z.infer<typeof ManagerJobSchema>;
export type ManagerJobList = z.infer<typeof ManagerJobListSchema>;
