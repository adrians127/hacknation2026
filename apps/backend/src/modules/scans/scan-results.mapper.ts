import type { RuleRef } from "@subsurf/contracts/rules/rule-ref.schema";
import type {
  HostLifecycle,
  ScanHost,
  ScanHostDetail,
  ScanService,
  ScanServiceDetail,
  HostHistoryEntry,
  ServiceObservation,
  ServiceSnapshot,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { ScanEdits } from "@subsurf/contracts/scans/scan-export.schema";
import type { Scan, ScanHostCounts } from "@subsurf/contracts/scans/scans.schema";
import type {
  ServiceVulnerability,
  VulnerabilitySummary,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";
import {
  WorkerErrorSchema,
  type ObservedHost,
} from "@subsurf/contracts/workers/worker-result.schema";

import type { Prisma, Scan as ScanRow } from "~backend/generated/prisma/client";
import { decryptText } from "~backend/lib/crypto";
import { toServiceRemediation } from "~backend/modules/defectdojo/defectdojo.mapper";
import { comparablePort } from "~backend/modules/results/comparable";
import { httpSummaries, openPortDetails, storedOpenPort } from "~backend/modules/results/details";
import { serviceFacts, type ChangeRowFacts } from "~backend/modules/rules/rule-match";
import { rateChange, type ChangeFacts } from "~backend/modules/scans/change-priority";
import { fieldChanges, hostnameChanges } from "~backend/modules/scans/field-changes";
import type { HostDiff, ServiceDiff } from "~backend/modules/scans/scan-diff";
import { EMPTY_SUMMARY } from "~backend/modules/vulnerabilities/vulnerabilities.mapper";

export const OBSERVATION_INCLUDE = {
  hostnames: { select: { name: true, source: true } },
  ports: true,
  result: { select: { workerId: true } },
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
  /** As of this scan. */
  lifecycle: HostLifecycle;
  /** Of the Service assets (their newest observation), whatever scan is viewed. */
  vulnerabilities: {
    host: VulnerabilitySummary;
    services: ReadonlyMap<string, VulnerabilitySummary>;
  };
  /** Rule names by id, for the triage a rule set. */
  rules: ReadonlyMap<string, string>;
}

function ruleRef(id: string | null, names: ReadonlyMap<string, string>): RuleRef | null {
  const name = id === null ? undefined : names.get(id);
  return id !== null && name !== undefined ? { id, name } : null;
}

/** A scan with its pipeline's name (`SCAN_INCLUDE`). */
export const SCAN_INCLUDE = { pipeline: { select: { id: true, name: true } } } as const satisfies Prisma.ScanInclude;

export type ScanWithPipeline = ScanRow & { pipeline: { id: string; name: string } | null };

export function toScan(scan: ScanWithPipeline, hosts: ScanHostCounts, openPorts: number): Scan {
  return {
    id: scan.id,
    status: scan.status,
    name: scan.name,
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
    pipeline: scan.pipeline,
    trigger: scan.trigger,
    windowEndsAt: scan.windowEndsAt?.toISOString() ?? null,
  };
}

const HOSTNAME_ORDER = { job: 0, tls_san: 1, ptr: 2 } as const;

export function hostnames(observation: ObservationRow | undefined): string[] {
  const sorted = (observation?.hostnames ?? []).toSorted(
    (a, b) => HOSTNAME_ORDER[a.source] - HOSTNAME_ORDER[b.source] || a.name.localeCompare(b.name),
  );
  return [...new Set(sorted.map((hostname) => hostname.name))];
}

const HOSTNAME_SOURCE = { job: "job", ptr: "ptr", tls_san: "tls-san" } as const;

/** The observation in the worker result's host shape again, with the sensitive fields decrypted. */
export function toObservedHost(observation: ObservationRow): ObservedHost {
  return {
    ip: observation.ip,
    status: observation.status,
    reason: observation.reason,
    observedAt: observation.observedAt?.toISOString() ?? null,
    latencyMs: observation.latencyMs,
    hostnames: observation.hostnames.map(({ name, source }) => ({
      name,
      source: HOSTNAME_SOURCE[source],
    })),
    error: WorkerErrorSchema.nullable().parse(observation.error),
    ports: observation.ports
      .toSorted((a, b) => a.port - b.port)
      .map((port) => storedOpenPort(port)),
  };
}

// Triage a rule set is not an edit: the rule sets it again wherever the file is imported.
const isEdited = (asset: {
  triage: string;
  triageRuleId: string | null;
  tags: readonly string[];
  note: unknown;
}) =>
  (asset.triage !== "unreviewed" && asset.triageRuleId === null) ||
  asset.tags.length > 0 ||
  asset.note !== null;

/** What users set on the host and on the services this observation saw open; defaults are left out. */
export function toScanEdits(observation: ObservationRow, host: HostRow | undefined): ScanEdits {
  if (!host) return { hosts: [], services: [] };
  const open = new Set(observation.ports.map((port) => port.serviceId));
  const edited = { triage: host.triage, tags: host.tags, note: decryptText(host.note) };
  return {
    hosts: isEdited(host) ? [{ ip: host.ip, ...edited }] : [],
    services: host.services
      .filter(
        (service) =>
          open.has(service.id) &&
          (isEdited(service) ||
            service.nameOverride !== null ||
            service.productOverride !== null ||
            service.versionOverride !== null),
      )
      .toSorted((a, b) => a.port - b.port)
      .map((service) => ({
        ip: host.ip,
        protocol: service.protocol,
        port: service.port,
        triage: service.triage,
        tags: service.tags,
        note: decryptText(service.note),
        nameOverride: service.nameOverride,
        productOverride: service.productOverride,
        versionOverride: service.versionOverride,
      })),
  };
}

export interface ResolvedService {
  diff: ServiceDiff;
  service: ServiceRow;
  port: PortRow;
  /** The base scan's observation of the port, if it was open there. */
  basePort: PortRow | undefined;
}

/** Pairs each service of the diff with its asset and the observation that describes it. */
export function resolveServices(entry: HostInScan): ResolvedService[] {
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
  entry: HostInScan,
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
    triageRule: ruleRef(service.triageRuleId, entry.rules),
    tags: service.tags,
    note: decryptText(service.note),
    vulnerabilities: entry.vulnerabilities.services.get(service.id) ?? EMPTY_SUMMARY,
    remediation: toServiceRemediation(service),
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
    lifecycle: entry.lifecycle,
    triage: host.triage,
    triageRule: ruleRef(host.triageRuleId, entry.rules),
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
        ...serviceFields(resolved, entry),
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
    tls: details.tls,
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
        ...serviceFields(resolved, entry),
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

const identityText = (port: PortRow | undefined) =>
  port ? [port.serviceName, port.serviceProduct, port.serviceVersion].filter(Boolean).join(" ") || null : null;

/**
 * The host's changes as rows for export and the dashboard (`ScanChangeRowSchema`), rated by the
 * built-in rules, with what `change_priority` rules match on.
 */
export function toChangeFacts(entry: HostInScan): ChangeRowFacts[] {
  const { diff, host, current, base } = entry;
  // Kept in a const: narrowing does not reach into the callbacks below.
  const hostChange = diff.change;
  if (hostChange === null || hostChange === "unchanged") return [];
  const common = {
    hostId: host.id,
    ip: host.ip,
    hostnames: hostnames(current.status === "up" ? current : base),
    lifecycle: entry.lifecycle,
    endpoint: null,
    key: null,
  };
  const hostLevel: ChangeFacts[] =
    hostChange === "changed"
      ? current.status === "up" && base
        ? hostnameChanges(hostnames(base), hostnames(current)).map((change) => ({
            ...common,
            protocol: null,
            port: null,
            change: hostChange,
            field: change.field,
            before: change.before,
            after: change.after,
          }))
        : []
      : [
          {
            ...common,
            protocol: null,
            port: null,
            change: hostChange,
            field: null,
            before: diff.baseStatus,
            after: current.status,
          },
        ];
  // An unknown host's services are not known to have changed.
  const services: ChangeFacts[] =
    hostChange === "unknown"
      ? []
      : resolveServices(entry).flatMap((resolved): ChangeFacts[] => {
          const { change } = resolved.diff;
          const service = { ...common, protocol: resolved.port.protocol, port: resolved.port.port };
          if (change === "new" || change === "gone") {
            return [
              {
                ...service,
                change,
                field: null,
                before: change === "gone" ? identityText(resolved.port) : null,
                after: change === "new" ? identityText(resolved.port) : null,
              },
            ];
          }
          return changesOf(resolved).map((field) => ({
            ...service,
            change: "changed" as const,
            field: field.field,
            endpoint: field.endpoint,
            key: field.key,
            before: field.before,
            after: field.after,
          }));
        });
  const hostFacts = { ipNumber: Number(diff.ipNumber), tags: host.tags };
  const byPort = new Map(
    resolveServices(entry).map(({ service, port }) => [
      service.port,
      serviceFacts(
        service.port,
        { name: service.nameOverride, product: service.productOverride },
        { name: port.serviceName, product: port.serviceProduct },
      ),
    ]),
  );
  return [...hostLevel, ...services].map((row) => ({
    row: rateChange(row, hostChange),
    host: hostFacts,
    service: row.port === null ? null : (byPort.get(row.port) ?? null),
  }));
}
