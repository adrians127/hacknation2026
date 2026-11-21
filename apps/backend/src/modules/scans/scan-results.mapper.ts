import type {
  ScanHost,
  ScanHostDetail,
  ScanService,
  ScanServiceDetail,
  HostHistoryEntry,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { Scan, ScanHostCounts } from "@subsurf/contracts/scans/scans.schema";

import type { Prisma, Scan as ScanRow } from "~backend/generated/prisma/client";
import { decryptText } from "~backend/lib/crypto";
import { httpSummaries, openPortDetails } from "~backend/modules/results/details";
import type { HostDiff, ServiceDiff } from "~backend/modules/scans/scan-diff";

export const OBSERVATION_INCLUDE = {
  hostnames: { select: { name: true, source: true } },
  ports: true,
} as const satisfies Prisma.HostObservationInclude;

export type ObservationRow = Prisma.HostObservationGetPayload<{ include: typeof OBSERVATION_INCLUDE }>;
export type HostRow = Prisma.HostGetPayload<{ include: { services: true } }>;
type PortRow = ObservationRow["ports"][number];
type ServiceRow = HostRow["services"][number];

/** One host of a scan, with what is needed to describe it. */
export interface HostInScan {
  diff: HostDiff;
  host: HostRow;
  /** This scan's observation of the address. */
  current: ObservationRow;
  /** The base scan's `up` observation, if any. */
  base: ObservationRow | undefined;
}

export function toScan(scan: ScanRow, hosts: ScanHostCounts, openPorts: number): Scan {
  return {
    id: scan.id,
    status: scan.status,
    createdAt: scan.createdAt.toISOString(),
    startedAt: scan.startedAt?.toISOString() ?? null,
    finishedAt: scan.finishedAt?.toISOString() ?? null,
    durationMs:
      scan.startedAt && scan.finishedAt
        ? scan.finishedAt.getTime() - scan.startedAt.getTime()
        : null,
    targetCount: scan.targetCount,
    addressCount: scan.addressCount,
    jobCount: scan.jobCount,
    hosts,
    openPorts,
  };
}

const HOSTNAME_ORDER = { job: 0, tls_san: 1, ptr: 2 } as const;

function hostnames(observation: ObservationRow | undefined): string[] {
  const sorted = (observation?.hostnames ?? []).toSorted(
    (a, b) => HOSTNAME_ORDER[a.source] - HOSTNAME_ORDER[b.source] || a.name.localeCompare(b.name),
  );
  return [...new Set(sorted.map((hostname) => hostname.name))];
}

interface ResolvedService {
  diff: ServiceDiff;
  service: ServiceRow;
  port: PortRow;
}

/** Pairs each service of the diff with its asset and the observation that describes it. */
function resolveServices(entry: HostInScan): ResolvedService[] {
  return entry.diff.services.flatMap((diff) => {
    const observation = diff.observedIn === "current" ? entry.current : entry.base;
    const port = observation?.ports.find((candidate) => candidate.serviceId === diff.serviceId);
    const service = entry.host.services.find((candidate) => candidate.id === diff.serviceId);
    return port && service ? [{ diff, service, port }] : [];
  });
}

function serviceFields({ diff, service, port }: ResolvedService) {
  return {
    id: service.id,
    protocol: service.protocol,
    port: service.port,
    change: diff.change,
    observed: { name: port.serviceName, product: port.serviceProduct, version: port.serviceVersion },
    overrides: {
      name: service.nameOverride,
      product: service.productOverride,
      version: service.versionOverride,
    },
    triage: service.triage,
    tags: service.tags,
    note: decryptText(service.note),
  };
}

function hostFields(entry: HostInScan) {
  const { current, host } = entry;
  return {
    id: host.id,
    ip: host.ip,
    status: current.status,
    observedAt: current.observedAt?.toISOString() ?? null,
    latencyMs: current.latencyMs,
    // A host that is gone keeps the names it had when it was last up.
    hostnames: hostnames(current.status === "up" ? current : entry.base),
    change: entry.diff.change,
    triage: host.triage,
    tags: host.tags,
    note: decryptText(host.note),
  };
}

export function toScanHost(entry: HostInScan): ScanHost {
  return {
    ...hostFields(entry),
    services: resolveServices(entry).map(
      (resolved): ScanService => ({
        ...serviceFields(resolved),
        http: httpSummaries(resolved.port.details),
      }),
    ),
  };
}

export function toScanHostDetail(entry: HostInScan, history: HostHistoryEntry[]): ScanHostDetail {
  return {
    ...hostFields(entry),
    firstSeenAt: entry.host.firstSeenAt.toISOString(),
    lastSeenAt: entry.host.lastSeenAt.toISOString(),
    history,
    services: resolveServices(entry).map((resolved): ScanServiceDetail => {
      const { port, service } = resolved;
      const details = openPortDetails(port.details);
      return {
        ...serviceFields(resolved),
        http: details.http,
        reason: port.reason,
        extraInfo: port.serviceExtraInfo,
        cpe: port.serviceCpe,
        method: port.serviceMethod,
        confidence: port.serviceConfidence,
        identity: details.identity,
        banner: details.banner,
        scripts: details.scripts,
        firstSeenAt: service.firstSeenAt.toISOString(),
        lastSeenAt: service.lastSeenAt.toISOString(),
      };
    }),
  };
}
