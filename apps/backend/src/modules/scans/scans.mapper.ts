import type { QueuedScan } from "@subsurf/contracts/scans/scans.schema";

import type { Scan } from "~backend/generated/prisma/client";

export function toQueuedScan(scan: Scan): QueuedScan {
  return {
    id: scan.id,
    status: scan.status,
    targetCount: scan.targetCount,
    addressCount: scan.addressCount,
    jobCount: scan.jobCount,
    ports: scan.ports,
    maxRate: scan.maxRate,
  };
}
