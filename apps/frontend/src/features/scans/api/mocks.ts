import type { Scan, ScanListResponse } from "@subsurf/contracts/scans/scans.schema";

const HOUR = 60 * 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const scans: Scan[] = [
  { id: crypto.randomUUID(), status: "completed", targetCount: 4, hostsFound: 1499, servicesFound: 4312, startedAt: ago(2 * HOUR), durationSeconds: 1840 },
  { id: crypto.randomUUID(), status: "stopped", targetCount: 4, hostsFound: 1102, servicesFound: 3190, startedAt: ago(26 * HOUR), durationSeconds: 3600 },
  { id: crypto.randomUUID(), status: "completed", targetCount: 3, hostsFound: 1431, servicesFound: 4198, startedAt: ago(50 * HOUR), durationSeconds: 2210 },
];

// MOCK: GET/POST /scans. Starting a scan prepends it as running; nothing ever finishes it.
export const mockScans = {
  list: (): ScanListResponse => ({ items: scans }),
  start(): Scan {
    const scan: Scan = {
      id: crypto.randomUUID(),
      status: "running",
      targetCount: 4,
      hostsFound: 0,
      servicesFound: 0,
      startedAt: new Date().toISOString(),
      durationSeconds: null,
    };
    scans.unshift(scan);
    return scan;
  },
};
