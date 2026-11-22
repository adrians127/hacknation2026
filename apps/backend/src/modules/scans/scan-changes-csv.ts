import type { ScanChangesResponse } from "@subsurf/contracts/scans/scan-changes.schema";

import { toCsv } from "~backend/lib/csv";

const HEADER = [
  "ip",
  "hostnames",
  "protocol",
  "port",
  "change",
  "field",
  "endpoint",
  "key",
  "before",
  "after",
  "priority",
  "reason",
  "lifecycle",
] as const;

export function changesCsv(changes: ScanChangesResponse): string {
  return toCsv(
    HEADER,
    changes.items.map((row) => [
      row.ip,
      row.hostnames.join(" "),
      row.protocol,
      row.port,
      row.change,
      row.field,
      row.endpoint && `${row.endpoint.scheme}://${row.endpoint.vhost ?? row.ip}`,
      row.key,
      row.before,
      row.after,
      row.priority,
      row.reason,
      row.lifecycle.state,
    ]),
  );
}

/** When the scan started, or its id for one that has not. */
const stamp = (scan: ScanChangesResponse["scan"] | null) =>
  scan?.startedAt ? scan.startedAt.slice(0, 16).replaceAll(/[:T]/g, "-") : (scan?.id.slice(0, 8) ?? "none");

/** `scan-changes-2026-11-20-01-00-to-2026-11-21-01-00.csv` */
export function changesFileName(changes: ScanChangesResponse): string {
  return `scan-changes-${stamp(changes.baseScan)}-to-${stamp(changes.scan)}.csv`;
}
