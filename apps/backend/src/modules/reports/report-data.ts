import type { ServiceRemediation } from "@subsurf/contracts/defectdojo/defectdojo.schema";
import {
  effectiveServiceIdentity,
  type ServiceIdentity,
  type TriageStatus,
} from "@subsurf/contracts/hosts/hosts.schema";
import type { ReportScan, ServiceSnapshot } from "@subsurf/contracts/reports/reports.schema";
import type { ScanChange } from "@subsurf/contracts/scans/scan-results.schema";
import type { HostStatus, HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

import type { Scan as ScanRow } from "~backend/generated/prisma/client";
import { toServiceRemediation } from "~backend/modules/defectdojo/defectdojo.mapper";
import { openPortDetails, type PortDetails } from "~backend/modules/results/details";
import {
  hostnames,
  resolveServices,
  type HostInScan,
  type HostRow,
  type ObservationRow,
} from "~backend/modules/scans/scan-results.mapper";

type PortRow = ObservationRow["ports"][number];
type ServiceRow = HostRow["services"][number];

/** A service as reports see it: decrypted details, the user's corrections applied. */
export interface ReportService {
  serviceId: string;
  hostId: string;
  ip: string;
  port: number;
  protocol: "tcp";
  change: ScanChange | null;
  /** Open in this scan (not `gone`, and not carried over from the base scan for an `unknown` host). */
  present: boolean;
  identity: ServiceIdentity;
  observed: ServiceIdentity;
  extraInfo: string | null;
  cpe: string[];
  details: PortDetails;
  fingerprint: string;
  triage: TriageStatus;
  tags: string[];
  remediation: ServiceRemediation | null;
}

export interface ReportHost {
  hostId: string;
  ip: string;
  ipNumber: bigint;
  hostnames: string[];
  status: HostStatus;
  change: ScanChange | null;
  triage: TriageStatus;
  tags: string[];
  services: ReportService[];
}

export function toReportScan(scan: Pick<ScanRow, "id" | "status" | "createdAt" | "startedAt" | "finishedAt">): ReportScan {
  return {
    id: scan.id,
    status: scan.status,
    createdAt: scan.createdAt.toISOString(),
    startedAt: scan.startedAt?.toISOString() ?? null,
    finishedAt: scan.finishedAt?.toISOString() ?? null,
  };
}

/** When a scan ran, for ordering and display. */
export const scanTime = (scan: Pick<ScanRow, "createdAt" | "startedAt">): Date => scan.startedAt ?? scan.createdAt;

export function observedIdentity(port: PortRow): ServiceIdentity {
  return { name: port.serviceName, product: port.serviceProduct, version: port.serviceVersion };
}

export function toReportService(
  host: Pick<HostRow, "id" | "ip">,
  service: ServiceRow,
  port: PortRow,
  change: ScanChange | null,
  present: boolean,
): ReportService {
  const observed = observedIdentity(port);
  return {
    serviceId: service.id,
    hostId: host.id,
    ip: host.ip,
    port: service.port,
    protocol: service.protocol,
    change,
    present,
    identity: effectiveServiceIdentity({
      observed,
      overrides: { name: service.nameOverride, product: service.productOverride, version: service.versionOverride },
    }),
    observed,
    extraInfo: port.serviceExtraInfo,
    cpe: port.serviceCpe,
    details: openPortDetails(port.details),
    fingerprint: port.fingerprint,
    triage: service.triage,
    tags: service.tags,
    remediation: toServiceRemediation(service),
  };
}

export function toReportHosts(entries: readonly HostInScan[]): ReportHost[] {
  return entries.map((entry) => {
    const isUp = entry.current.status === "up";
    return {
      hostId: entry.host.id,
      ip: entry.host.ip,
      ipNumber: entry.diff.ipNumber,
      hostnames: hostnames(isUp ? entry.current : entry.base),
      status: entry.current.status,
      change: entry.diff.change,
      triage: entry.host.triage,
      tags: entry.host.tags,
      services: resolveServices(entry).map(({ diff, service, port }) =>
        toReportService(entry.host, service, port, diff.change, isUp && diff.observedIn === "current"),
      ),
    };
  });
}

/** Only what this scan actually saw open. */
export const presentServices = (hosts: readonly ReportHost[]): ReportService[] =>
  hosts.flatMap((host) => host.services.filter((service) => service.present));

/** Headers that name software; the rest vary per request. */
export const SOFTWARE_HEADERS = new Set([
  "server",
  "x-powered-by",
  "x-generator",
  "x-aspnet-version",
  "x-aspnetmvc-version",
]);

export function headerValues(endpoint: HttpEndpoint, name: string): string[] {
  return endpoint.headers.filter((header) => header.name.toLowerCase() === name).map((header) => header.value);
}

export function snapshotOf(identity: ServiceIdentity, details: PortDetails): ServiceSnapshot {
  const software = details.http.flatMap((endpoint) =>
    endpoint.headers
      .filter((header) => SOFTWARE_HEADERS.has(header.name.toLowerCase()))
      .map((header) => `${header.name.toLowerCase()}: ${header.value}`),
  );
  const cert = details.http.find((endpoint) => endpoint.tls)?.tls?.cert ?? null;
  return {
    identity,
    software: [...new Set(software)].toSorted(),
    http: details.http.map((endpoint) => ({
      url: endpoint.url,
      statusCode: endpoint.statusCode,
      title: endpoint.title,
      finalUrl: endpoint.finalUrl,
    })),
    certSha256: cert?.sha256 ?? details.identity.tlsCertSha256,
    certNotAfter: cert?.notAfter ?? null,
  };
}

export const EMPTY_TRIAGE_COUNTS = (): Record<TriageStatus, number> => ({
  unreviewed: 0,
  reviewed: 0,
  important: 0,
  false_positive: 0,
});

export function byIpNumber(a: { ipNumber: bigint }, b: { ipNumber: bigint }): number {
  return a.ipNumber < b.ipNumber ? -1 : a.ipNumber > b.ipNumber ? 1 : 0;
}

export function ipToNumber(ip: string): bigint {
  return ip.split(".").reduce((value, octet) => value * 256n + BigInt(octet), 0n);
}
