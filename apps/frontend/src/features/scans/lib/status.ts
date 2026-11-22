import type { ScanJobStatus, ScanStatus } from "@subsurf/contracts/scans/scans.schema";

export const SCAN_STATUS_VARIANT = {
  queued: "outline",
  running: "default",
  paused: "outline",
  completed: "secondary",
  stopped: "outline",
  failed: "destructive",
} as const satisfies Record<ScanStatus, string>;

export const JOB_STATUS_VARIANT = {
  queued: "outline",
  leased: "default",
  completed: "secondary",
  stopped: "outline",
  failed: "destructive",
} as const satisfies Record<ScanJobStatus, string>;

/** Still queued, running or waiting for its next time window: its numbers keep changing. */
export const isScanActive = (status: ScanStatus | undefined) =>
  status === "queued" || status === "running" || status === "paused";

/** How often pages showing an active scan refresh it. */
export const LIVE_SCAN_REFRESH_MS = 5000;
