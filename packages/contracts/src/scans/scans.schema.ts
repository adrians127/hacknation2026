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

/** `discovery` finds open ports in address ranges; `service` identifies what listens on them. */
export const ScanJobKindSchema = z.enum(["discovery", "service"]);
export const ScanJobStatusSchema = z.enum(["queued", "leased", "completed", "failed", "stopped"]);

/** A domain the backend resolved, and one of its addresses (kept for HTTP Host/SNI). */
export const ScanJobHostSchema = z.object({ ip: z.ipv4(), domain: z.string() });

const PORT_SPEC_PATTERN = /^\d{1,5}(?:-\d{1,5})?(?:,\d{1,5}(?:-\d{1,5})?)*$/;

/** TCP ports and ranges, e.g. `22,80,8000-8100`. */
export const PortSpecSchema = z
  .string()
  .regex(PORT_SPEC_PATTERN)
  .refine(
    (spec) =>
      spec.split(",").every((part) => {
        const [from = 0, to = from] = part.split("-").map(Number);
        return from >= 1 && from <= to && to <= 65535;
      }),
    { message: "Ports must be within 1-65535 and ranges written low-high" },
  );

/** A scan queued by an import, with the parameters the backend snapshotted from its defaults. */
export const QueuedScanSchema = z.object({
  id: z.uuid(),
  status: ScanStatusSchema,
  targetCount: z.number().int().nonnegative(),
  addressCount: z.number().int().nonnegative(),
  jobCount: z.number().int().nonnegative(),
  ports: PortSpecSchema,
  maxRate: z.number().int().positive(),
});

export type ScanStatus = z.infer<typeof ScanStatusSchema>;
export type Scan = z.infer<typeof ScanSchema>;
export type ScanListResponse = z.infer<typeof ScanListResponseSchema>;
export type ScanJobKind = z.infer<typeof ScanJobKindSchema>;
export type ScanJobStatus = z.infer<typeof ScanJobStatusSchema>;
export type ScanJobHost = z.infer<typeof ScanJobHostSchema>;
export type QueuedScan = z.infer<typeof QueuedScanSchema>;
