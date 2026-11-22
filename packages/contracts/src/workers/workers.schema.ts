import { z } from "zod";

import { WorkerResultSchema } from "./worker-result.schema";

const TcpPortSchema = z.number().int().min(1).max(65535);

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
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
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
