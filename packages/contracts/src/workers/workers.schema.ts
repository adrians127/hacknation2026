import { z } from "zod";

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
