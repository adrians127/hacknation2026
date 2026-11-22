import {
  DASHBOARD_TOP_DETECTIONS,
  type DashboardResponse,
} from "@subsurf/contracts/dashboard/dashboard.schema";

import { groupChanges, topChanges } from "~backend/modules/dashboard/top-changes";
import { scanResultsService } from "~backend/modules/scans/scan-results.service";
import { signatureMatchesService } from "~backend/modules/signatures/signature-matches.service";

const EMPTY: DashboardResponse = {
  scan: null,
  baseScan: null,
  hosts: { up: 0, unstable: 0, inactive: 0 },
  openPorts: 0,
  changes: null,
  priorities: { high: 0, medium: 0, low: 0 },
  muted: 0,
  topChanges: [],
  detections: { hosts: { high: 0, medium: 0, low: 0, info: 0 }, top: [] },
};

/** The newest scan with results against the previous one (PDF item 15, section 3's report). */
export const dashboardService = {
  async get(): Promise<DashboardResponse> {
    const latest = await scanResultsService.latestWithResults();
    if (!latest) return EMPTY;
    const [scan, changes, lifecycle, detections, hostsBySeverity] = await Promise.all([
      scanResultsService.get(latest.id),
      scanResultsService.changes(latest.id),
      scanResultsService.lifecycleCounts(latest.id),
      scanResultsService.detections(latest.id),
      signatureMatchesService.hostsBySeverity(latest.id),
    ]);
    const shown = changes.items.filter((row) => !row.muted);
    const groups = groupChanges(shown);
    const count = (priority: keyof DashboardResponse["priorities"]) =>
      groups.filter((group) => group.priority === priority).length;
    return {
      scan: changes.scan,
      baseScan: changes.baseScan,
      hosts: { up: scan.hosts.up, ...lifecycle },
      openPorts: scan.openPorts,
      changes: scan.changes,
      priorities: { high: count("high"), medium: count("medium"), low: count("low") },
      muted: changes.items.length - shown.length,
      topChanges: topChanges(groups),
      detections: {
        hosts: hostsBySeverity,
        top: detections.items.filter((item) => item.severity !== null).slice(0, DASHBOARD_TOP_DETECTIONS),
      },
    };
  },
};
