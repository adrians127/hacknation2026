import type { Change, DashboardResponse } from "@subsurf/contracts/dashboard/dashboard.schema";

const HOUR = 60 * 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const recentChanges: Change[] = [
  { id: crypto.randomUUID(), kind: "new", host: "10.20.4.17", service: "8443/https", detail: "Admin panel detected (/admin)", detectedAt: ago(2 * HOUR) },
  { id: crypto.randomUUID(), kind: "new", host: "172.16.9.40", service: "80/http", detail: "WordPress 6.4 fingerprint", detectedAt: ago(2 * HOUR) },
  { id: crypto.randomUUID(), kind: "changed", host: "example-agh.pl", service: "443/https", detail: "TLS certificate renewed", detectedAt: ago(3 * HOUR) },
  { id: crypto.randomUUID(), kind: "disappeared", host: "10.20.1.5", service: "21/ftp", detail: "No response in 3 consecutive scans", detectedAt: ago(26 * HOUR) },
  { id: crypto.randomUUID(), kind: "changed", host: "10.20.7.9", service: "22/ssh", detail: "Banner changed: OpenSSH 8.9 -> 9.6", detectedAt: ago(26 * HOUR) },
];

const count = (kind: Change["kind"]) => recentChanges.filter((change) => change.kind === kind).length;

// MOCK: GET /dashboard
export const mockDashboard = (): DashboardResponse => ({
  activeHosts: 1499,
  newServices: count("new"),
  disappearedServices: count("disappeared"),
  changedServices: count("changed"),
  recentChanges,
});
