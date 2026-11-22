import type { FindingSeverity } from "@subsurf/contracts/reports/reports.schema";
import type { HostStatus } from "@subsurf/contracts/workers/worker-result.schema";

export const SEVERITY_CLASS: Record<FindingSeverity, string> = {
  high: "border-red-500/40 bg-red-500/10 text-red-500",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  low: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  info: "text-muted-foreground",
};

/** One square per scan in a status strip; greys on paper. */
export const STATUS_CELL: Record<HostStatus, string> = {
  up: "bg-emerald-500 print:bg-neutral-800",
  down: "bg-red-500/70 print:bg-neutral-300",
  timeout: "bg-amber-500/70 print:bg-neutral-500",
  cancelled: "bg-muted print:border print:bg-white",
  failed: "bg-muted print:border print:bg-white",
};
