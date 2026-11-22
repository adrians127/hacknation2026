import {
  DASHBOARD_TOP_CHANGES,
  type DashboardChange,
} from "@subsurf/contracts/dashboard/dashboard.schema";
import type { ChangePriority, ScanChangeRow } from "@subsurf/contracts/scans/scan-changes.schema";

import { PRIORITY_ORDER } from "~backend/modules/scans/change-priority";

const byPriority = (a: { priority: ChangePriority }, b: { priority: ChangePriority }) =>
  PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];

/**
 * Change rows grouped into what a person reads: one item per new, gone or unknown host (with
 * the ports it opened or closed), one per changed service. An item is as important as its most
 * important row.
 */
export function groupChanges(rows: readonly ScanChangeRow[]): DashboardChange[] {
  const hostWide = new Set(
    rows.filter((row) => row.port === null && row.field === null).map((row) => row.hostId),
  );
  const groups = new Map<string, ScanChangeRow[]>();
  for (const row of rows) {
    const key = hostWide.has(row.hostId) ? row.hostId : `${row.hostId} ${row.port ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].flatMap((group) => {
    const sorted = group.toSorted(byPriority);
    const [first] = sorted;
    if (!first) return [];
    const wholeHost = hostWide.has(first.hostId);
    const head = wholeHost ? (group.find((row) => row.port === null) ?? first) : first;
    return [
      {
        hostId: head.hostId,
        ip: head.ip,
        hostnames: head.hostnames,
        port: wholeHost ? null : head.port,
        change: head.change,
        priority: first.priority,
        reasons: [...new Set(sorted.map((row) => row.reason))],
        ports: wholeHost ? group.flatMap((row) => (row.port === null ? [] : [row.port])) : [],
        fields: group.flatMap((row) =>
          row.field === null
            ? []
            : [{ field: row.field, endpoint: row.endpoint, key: row.key, before: row.before, after: row.after }],
        ),
        lifecycle: head.lifecycle,
      },
    ];
  });
}

/** The most important grouped changes; ties keep address order. */
export function topChanges(groups: readonly DashboardChange[]): DashboardChange[] {
  return groups.toSorted(byPriority).slice(0, DASHBOARD_TOP_CHANGES);
}
