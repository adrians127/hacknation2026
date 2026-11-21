import { z } from "zod";

const TcpPortSchema = z.number().int().min(1).max(65535);

export const NmapTargetSchema = z.object({
  ip: z.ipv4(),
  domain: z.string().max(253).nullable().optional(),
  tcp_ports: z.array(TcpPortSchema).min(1).max(4096),
});

export const NmapJobSchema = z.object({
  job_id: z.string().min(1).max(256),
  lease_id: z.string().min(1).max(256),
  subnet: z.cidrv4(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  limits: z
    .object({
      max_parallel: z.number().int().positive().optional(),
      max_rate_per_process: z.number().int().positive().optional(),
      host_timeout_ms: z.number().int().positive().optional(),
    })
    .optional(),
  targets: z.array(NmapTargetSchema).min(1).max(1024),
});

export const NmapLeaseRequestSchema = z.object({});

export const NmapHeartbeatSchema = z.object({
  job_id: z.string().min(1).max(256),
  lease_id: z.string().min(1).max(256),
});

export type NmapJob = z.infer<typeof NmapJobSchema>;
