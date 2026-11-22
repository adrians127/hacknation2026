import type {
  ScanHost,
  ScanHostDetail,
  ScanService,
  ScanServiceDetail,
  HostHistoryEntry,
  ServiceObservation,
  ServiceSnapshot,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { Scan, ScanHostCounts } from "@subsurf/contracts/scans/scans.schema";
import type {
  ServiceVulnerability,
  VulnerabilitySummary,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import type { Prisma, Scan as ScanRow } from "~backend/generated/prisma/client";
import { decryptText } from "~backend/lib/crypto";
import { comparablePort } from "~backend/modules/results/comparable";
import { httpSummaries, openPortDetails, storedOpenPort } from "~backend/modules/results/details";
import { fieldChanges, hostnameChanges } from "~backend/modules/scans/field-changes";
import type { HostDiff, ServiceDiff } from "~backend/modules/scans/scan-diff";
import { EMPTY_SUMMARY } from "~backend/modules/vulnerabilities/vulnerabilities.mapper";

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
  /** Of the Service assets (their newest observation), whatever scan is viewed. */
  vulnerabilities: {
    host: VulnerabilitySummary;
    services: ReadonlyMap<string, VulnerabilitySummary>;
  };
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
  /** The base scan's observation of the port, if it was open there. */
  basePort: PortRow | undefined;
}

/** Pairs each service of the diff with its asset and the observation that describes it. */
function resolveServices(entry: HostInScan): ResolvedService[] {
  return entry.diff.services.flatMap((diff) => {
    const basePort = entry.base?.ports.find((candidate) => candidate.serviceId === diff.serviceId);
    const port =
      diff.observedIn === "current"
        ? entry.current.ports.find((candidate) => candidate.serviceId === diff.serviceId)
        : basePort;
    const service = entry.host.services.find((candidate) => candidate.id === diff.serviceId);
    return port && service ? [{ diff, service, port, basePort }] : [];
  });
}

const identityOf = (port: PortRow) => ({
  name: port.serviceName,
  product: port.serviceProduct,
  version: port.serviceVersion,
});

const snapshotOf = (port: PortRow | undefined): ServiceSnapshot | null =>
  port ? { observed: identityOf(port), http: httpSummaries(port.details) } : null;

function serviceFields(
  { diff, service, port, basePort }: ResolvedService,
  summaries: ReadonlyMap<string, VulnerabilitySummary>,
) {
  return {
    id: service.id,
    protocol: service.protocol,
    port: service.port,
    change: diff.change,
    observed: identityOf(port),
    before: snapshotOf(basePort),
    overrides: {
      name: service.nameOverride,
      product: service.productOverride,
      version: service.versionOverride,
    },
    triage: service.triage,
    tags: service.tags,
    note: decryptText(service.note),
    vulnerabilities: summaries.get(service.id) ?? EMPTY_SUMMARY,
  };
}

function hostFields(entry: HostInScan) {
  const { current, host } = entry;
  return {
    id: host.id,
    ip: host.ip,
    status: current.status,
    baseStatus: entry.diff.baseStatus,
    observedAt: current.observedAt?.toISOString() ?? null,
    latencyMs: current.latencyMs,
    // A host that is gone keeps the names it had when it was last up.
    hostnames: hostnames(current.status === "up" ? current : entry.base),
    change: entry.diff.change,
    triage: host.triage,
    tags: host.tags,
    note: decryptText(host.note),
    vulnerabilities: entry.vulnerabilities.host,
  };
}

export function toScanHost(entry: HostInScan): ScanHost {
  return {
    ...hostFields(entry),
    services: resolveServices(entry).map(
      (resolved): ScanService => ({
        ...serviceFields(resolved, entry.vulnerabilities.services),
        http: httpSummaries(resolved.port.details),
      }),
    ),
  };
}

function observationOf(port: PortRow): ServiceObservation {
  const details = openPortDetails(port.details);
  return {
    observed: identityOf(port),
    reason: port.reason,
    extraInfo: port.serviceExtraInfo,
    cpe: port.serviceCpe,
    method: port.serviceMethod,
    confidence: port.serviceConfidence,
    identity: details.identity,
    banner: details.banner,
    scripts: details.scripts,
    http: details.http,
  };
}

/** Field-level differences of a `changed` service (both scans saw the port open). */
function changesOf({ diff, port, basePort }: ResolvedService) {
  if (diff.change !== "changed" || !basePort || basePort === port) return [];
  return fieldChanges(
    comparablePort(storedOpenPort(basePort)),
    comparablePort(storedOpenPort(port)),
  );
}

export function toScanHostDetail(
  entry: HostInScan,
  history: HostHistoryEntry[],
  matches: ReadonlyMap<string, ServiceVulnerability[]>,
): ScanHostDetail {
  const upInBoth = entry.current.status === "up" && entry.base !== undefined;
  return {
    ...hostFields(entry),
    fieldChanges: upInBoth ? hostnameChanges(hostnames(entry.base), hostnames(entry.current)) : [],
    firstSeenAt: entry.host.firstSeenAt.toISOString(),
    lastSeenAt: entry.host.lastSeenAt.toISOString(),
    history,
    services: resolveServices(entry).map((resolved): ScanServiceDetail => {
      const { port, service, basePort } = resolved;
      return {
        ...serviceFields(resolved, entry.vulnerabilities.services),
        ...observationOf(port),
        before: basePort ? observationOf(basePort) : null,
        fieldChanges: changesOf(resolved),
        firstSeenAt: service.firstSeenAt.toISOString(),
        lastSeenAt: service.lastSeenAt.toISOString(),
        vulnerabilityMatches: matches.get(service.id) ?? [],
      };
    }),
  };
}
