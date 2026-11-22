import type { IpReport } from "@subsurf/contracts/reports/reports.schema";
import type { HostStatus } from "@subsurf/contracts/workers/worker-result.schema";

import { decryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { bySeverity, findingsFor } from "~backend/modules/reports/findings";
import {
  observedIdentity,
  scanTime,
  snapshotOf,
  toReportService,
} from "~backend/modules/reports/report-data";
import { technologiesOf } from "~backend/modules/reports/technologies";
import { openPortDetails } from "~backend/modules/results/details";
import { toServiceRemediation } from "~backend/modules/defectdojo/defectdojo.mapper";
import { hostnames, OBSERVATION_INCLUDE } from "~backend/modules/scans/scan-results.mapper";
import { effectiveIds } from "~backend/modules/scans/scan-results.service";

const isConclusive = (status: HostStatus) => status === "up" || status === "down";

export const ipReportService = {
  async report(ip: string): Promise<IpReport> {
    const scans = await prisma.hostObservation.findMany({ where: { ip }, distinct: ["scanId"], select: { scanId: true } });
    const ids = await effectiveIds(scans.map((scan) => scan.scanId), [ip]);
    if (ids.length === 0) throw HttpError.notFound("This address is not part of any scan");

    const [rows, host] = await Promise.all([
      prisma.hostObservation.findMany({
        where: { id: { in: ids } },
        include: { ...OBSERVATION_INCLUDE, scan: { select: { createdAt: true, startedAt: true } } },
      }),
      prisma.host.findUnique({ where: { ip }, include: { services: true } }),
    ]);
    const observations = rows.toSorted((a, b) => a.scan.createdAt.getTime() - b.scan.createdAt.getTime());
    const now = new Date();

    let previousUp: (typeof observations)[number] | undefined;
    const timeline = observations.map((row) => {
      const ports = row.ports.map((port) => port.port).toSorted((a, b) => a - b);
      const entry = {
        scanId: row.scanId,
        scannedAt: scanTime(row.scan).toISOString(),
        status: row.status,
        latencyMs: row.latencyMs,
        openPorts: ports,
        opened: [] as number[],
        closed: [] as number[],
        changed: [] as number[],
      };
      if (row.status !== "up") return entry;
      if (previousUp) {
        const before = new Map(previousUp.ports.map((port) => [port.port, port.fingerprint]));
        const openNow = new Set(ports);
        entry.opened = ports.filter((port) => !before.has(port));
        entry.closed = [...before.keys()].filter((port) => !openNow.has(port)).toSorted((a, b) => a - b);
        entry.changed = row.ports
          .filter((port) => before.has(port.port) && before.get(port.port) !== port.fingerprint)
          .map((port) => port.port)
          .toSorted((a, b) => a - b);
      }
      previousUp = row;
      return entry;
    });

    const statuses = observations.map((row) => row.status);
    const conclusive = statuses.filter(isConclusive);
    const up = statuses.filter((status) => status === "up").length;
    let transitions = 0;
    for (let index = 1; index < statuses.length; index += 1) {
      if ((statuses[index - 1] === "up") !== (statuses[index] === "up")) transitions += 1;
    }

    const upRows = observations.filter((row) => row.status === "up");
    const latestUp = upRows.at(-1);
    const latestConclusive = observations.findLast((row) => isConclusive(row.status));
    const services = (host?.services ?? [])
      .map((service) => {
        const states: IpReport["services"][number]["states"] = [];
        let lastFingerprint: string | null = null;
        let seen = 0;
        for (const row of upRows) {
          const port = row.ports.find((candidate) => candidate.serviceId === service.id);
          if (!port) {
            lastFingerprint = null;
            continue;
          }
          seen += 1;
          const at = scanTime(row.scan).toISOString();
          const current = states.at(-1);
          if (current && lastFingerprint === port.fingerprint) {
            current.lastScanAt = at;
            current.scans += 1;
          } else {
            states.push({
              firstScanAt: at,
              lastScanAt: at,
              scans: 1,
              snapshot: snapshotOf(observedIdentity(port), openPortDetails(port.details)),
            });
          }
          lastFingerprint = port.fingerprint;
        }
        return {
          serviceId: service.id,
          port: service.port,
          protocol: service.protocol,
          isOpen:
            latestConclusive?.status === "up" &&
            latestConclusive.ports.some((port) => port.serviceId === service.id),
          firstSeenAt: service.firstSeenAt.toISOString(),
          lastSeenAt: service.lastSeenAt.toISOString(),
          seenInScans: seen,
          triage: service.triage,
          tags: service.tags,
          note: decryptText(service.note),
          remediation: toServiceRemediation(service),
          states,
        };
      })
      .toSorted((a, b) => Number(b.isOpen) - Number(a.isOpen) || a.port - b.port);

    const latestServices =
      host && latestUp
        ? latestUp.ports.flatMap((port) => {
            const service = host.services.find((candidate) => candidate.id === port.serviceId);
            return service ? [toReportService(host, service, port, null, true)] : [];
          })
        : [];
    const last = observations.at(-1);

    return {
      generatedAt: now.toISOString(),
      ip,
      host: host && {
        id: host.id,
        hostnames: hostnames(latestUp),
        firstSeenAt: host.firstSeenAt.toISOString(),
        lastSeenAt: host.lastSeenAt.toISOString(),
        triage: host.triage,
        tags: host.tags,
        note: decryptText(host.note),
      },
      stats: {
        scans: observations.length,
        up,
        availability: conclusive.length === 0 ? null : conclusive.filter((status) => status === "up").length / conclusive.length,
        transitions,
        lastStatus: last?.status ?? "down",
      },
      timeline,
      services,
      findings: latestServices
        .filter((service) => service.triage !== "false_positive")
        .flatMap((service) => findingsFor(service, now))
        .toSorted(bySeverity),
      technologies: latestServices.flatMap((service) =>
        technologiesOf(service).map(({ name, category, instance }) => ({
          name,
          category,
          version: instance.version,
          port: instance.port,
        })),
      ),
    };
  },
};
