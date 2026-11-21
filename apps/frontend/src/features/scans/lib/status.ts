import type { ScanStatus } from "@subsurf/contracts/scans/scans.schema";

export const SCAN_STATUS_VARIANT = {
  queued: "outline",
  running: "default",
  completed: "secondary",
  stopped: "outline",
  failed: "destructive",
} as const satisfies Record<ScanStatus, string>;
