import type { DiffField, DiffReport, ServiceSnapshot } from "@subsurf/contracts/reports/reports.schema";
import type { ScanChange } from "@subsurf/contracts/scans/scan-results.schema";

import { HttpError } from "~backend/lib/http-error";
import { openPortDetails } from "~backend/modules/results/details";
import { observedIdentity, snapshotOf, toReportScan } from "~backend/modules/reports/report-data";
import { countChanges } from "~backend/modules/scans/scan-diff";
import { hostnames, type ObservationRow } from "~backend/modules/scans/scan-results.mapper";
import { findScan, scanResultsService } from "~backend/modules/scans/scan-results.service";

type PortRow = ObservationRow["ports"][number];

const snapshot = (port: PortRow | undefined): ServiceSnapshot | null =>
  port ? snapshotOf(observedIdentity(port), openPortDetails(port.details)) : null;

const same = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);

const statuses = (snap: ServiceSnapshot) => snap.http.map((endpoint) => endpoint.statusCode);
const titles = (snap: ServiceSnapshot) => snap.http.map((endpoint) => endpoint.title);
const targets = (snap: ServiceSnapshot) => snap.http.map((endpoint) => endpoint.finalUrl);

/** What differs between two snapshots of one service. */
export function changedFields(before: ServiceSnapshot, after: ServiceSnapshot): DiffField[] {
  const fields: DiffField[] = [];
  if (before.identity.name !== after.identity.name) fields.push("name");
  if (before.identity.product !== after.identity.product) fields.push("product");
  if (before.identity.version !== after.identity.version) fields.push("version");
  if (!same(before.software, after.software)) fields.push("software");
  if (!same(statuses(before), statuses(after))) fields.push("http-status");
  if (!same(titles(before), titles(after))) fields.push("http-title");
  if (!same(targets(before), targets(after))) fields.push("redirect");
  if (before.certSha256 !== after.certSha256) fields.push("certificate");
  return fields.length > 0 ? fields : ["other"];
}

export const diffReportService = {
  /** Scan `to` compared with scan `from`, by the rules of `scan-diff.ts`. */
  async diff(fromId: string, toId: string): Promise<DiffReport> {
    if (fromId === toId) throw HttpError.badRequest("Pick two different scans", "SAME_SCAN");
    const from = await findScan(fromId);
    const { scan, hosts } = await scanResultsService.hostsForReport(toId, fromId);

    const report: DiffReport["hosts"] = [];
    for (const entry of hosts) {
      const change = entry.diff.change;
      if (change === null || change === "unchanged") continue;
      const isUp = entry.current.status === "up";
      const services = entry.diff.services.flatMap((service) => {
        const serviceChange: ScanChange | null = service.change;
        if (serviceChange === null || serviceChange === "unchanged") return [];
        const beforePort = entry.base?.ports.find((port) => port.serviceId === service.serviceId);
        const afterPort = isUp ? entry.current.ports.find((port) => port.serviceId === service.serviceId) : undefined;
        const before = serviceChange === "new" ? null : snapshot(beforePort);
        const after = serviceChange === "gone" || serviceChange === "unknown" ? null : snapshot(afterPort);
        return [
          {
            serviceId: service.serviceId,
            port: service.port,
            protocol: service.protocol,
            change: serviceChange,
            before,
            after,
            fields: before && after ? changedFields(before, after) : [],
          },
        ];
      });
      report.push({
        hostId: entry.host.id,
        ip: entry.host.ip,
        hostnames: hostnames(isUp ? entry.current : entry.base),
        change,
        status: entry.current.status,
        triage: entry.host.triage,
        tags: entry.host.tags,
        services,
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      from: toReportScan(from),
      to: toReportScan(scan),
      counts: countChanges(hosts.map((entry) => entry.diff)),
      hosts: report,
    };
  },
};
