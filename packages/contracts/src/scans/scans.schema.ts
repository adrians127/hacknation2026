import { z } from "zod";

export const ScanStatusSchema = z.enum(["queued", "running", "completed", "stopped", "failed"]);

export const ScanSchema = z.object({
  id: z.uuid(),
  status: ScanStatusSchema,
  targetCount: z.number().int().nonnegative(),
  hostsFound: z.number().int().nonnegative(),
  servicesFound: z.number().int().nonnegative(),
  startedAt: z.iso.datetime(),
  durationSeconds: z.number().int().nonnegative().nullable(),
});

export const ScanListResponseSchema = z.object({ items: z.array(ScanSchema) });

export type ScanStatus = z.infer<typeof ScanStatusSchema>;
export type Scan = z.infer<typeof ScanSchema>;
export type ScanListResponse = z.infer<typeof ScanListResponseSchema>;
