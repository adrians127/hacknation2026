import { z } from "zod";

export const ScanStatusSchema = z.enum(["queued", "running", "completed", "stopped", "failed"]);

/**
 * How a scan came to be: `adhoc` from the target import form, `manual` and `scheduled` from a
 * scan configuration, `imported` from a results file.
 */
export const ScanOriginSchema = z.enum(["adhoc", "manual", "scheduled", "imported"]);

const CountSchema = z.number().int().nonnegative();

/** Addresses of a scan by what the workers answered (docs/worker-result-format.md). */
export const ScanHostCountsSchema = z.object({
  up: CountSchema,
  down: CountSchema,
  timeout: CountSchema,
  cancelled: CountSchema,
  failed: CountSchema,
});

export const ScanSchema = z.object({
  id: z.uuid(),
  status: ScanStatusSchema,
  /** Empty when nobody named it; an imported scan starts with its file's name. */
  name: z.string(),
  origin: ScanOriginSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  /** `finishedAt - startedAt`; `null` until the scan has finished. */
  durationMs: CountSchema.nullable(),
  targetCount: CountSchema,
  addressCount: CountSchema,
  jobCount: CountSchema,
  /** Addresses with a result so far; the rest are still queued. */
  hosts: ScanHostCountsSchema,
  openPorts: CountSchema,
});

export const ScanListResponseSchema = z.object({ items: z.array(ScanSchema) });

export const SCAN_NAME_MAX = 200;
export const SCAN_NOTE_MAX = 2000;

/** What a user may change on a scan, in any state. Results and parameters are never edited. */
export const UpdateScanBodySchema = z
  .object({
    name: z.string().max(SCAN_NAME_MAX).optional(),
    note: z.string().max(SCAN_NOTE_MAX).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

export const UpdatedScanSchema = z.object({ id: z.uuid(), name: z.string(), note: z.string() });

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
export type ScanOrigin = z.infer<typeof ScanOriginSchema>;
export type ScanHostCounts = z.infer<typeof ScanHostCountsSchema>;
export type Scan = z.infer<typeof ScanSchema>;
export type ScanListResponse = z.infer<typeof ScanListResponseSchema>;
export type UpdateScanBody = z.infer<typeof UpdateScanBodySchema>;
export type UpdatedScan = z.infer<typeof UpdatedScanSchema>;
export type ScanJobKind = z.infer<typeof ScanJobKindSchema>;
export type ScanJobStatus = z.infer<typeof ScanJobStatusSchema>;
export type ScanJobHost = z.infer<typeof ScanJobHostSchema>;
export type QueuedScan = z.infer<typeof QueuedScanSchema>;
