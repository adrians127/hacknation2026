import type {
  ExposureReport,
  FindingRule,
  FindingSeverity,
  FindingsReport,
  ScanSummaryReport,
  TagReportHost,
  TagsReport,
  TechnologiesReport,
  TriageItem,
  TriageReport,
} from "@subsurf/contracts/reports/reports.schema";
import type { ScanChangeCounts } from "@subsurf/contracts/scans/scan-results.schema";
import { WorkerScanSchema } from "@subsurf/contracts/workers/worker-result.schema";

import { prisma } from "~backend/lib/prisma";
import {
  countSeverities,
  EMPTY_SEVERITY_COUNTS,
  findingsFor,
  prioritize,
} from "~backend/modules/reports/findings";
import {
  EMPTY_TRIAGE_COUNTS,
  presentServices,
  toReportHosts,
  toReportScan,
  type ReportHost,
  type ReportService,
} from "~backend/modules/reports/report-data";
import { inventory, serviceGroups } from "~backend/modules/reports/technologies";
import { scanResultsService } from "~backend/modules/scans/scan-results.service";
import { loadActiveSet } from "~backend/modules/signatures/signature-catalog";

const DAY_MS = 86_400_000;
const DUE_SOON_DAYS = 14;
const RISK_EXPIRING_DAYS = 30;
const SUMMARY_LIMIT = 25;
const TOP = 10;

async function load(scanId: string) {
  const [{ scan, base, hosts }, set] = await Promise.all([
    scanResultsService.hostsForReport(scanId),
    loadActiveSet(),
  ]);
  return { scan, base, hosts: toReportHosts(hosts, set.signatures), now: new Date() };
}

const isUp = (host: ReportHost) => host.status === "up";

export function exposureOf(hosts: readonly ReportHost[]): Omit<ExposureReport, "generatedAt" | "scan"> {
  const up = hosts.filter(isUp);
  const services = presentServices(up);
  const ports = new Map<number, { hosts: Set<string>; newHosts: Set<string>; names: Map<string, number> }>();
  for (const service of services) {
    const entry = ports.get(service.port) ?? { hosts: new Set(), newHosts: new Set(), names: new Map() };
    entry.hosts.add(service.hostId);
    if (service.change === "new") entry.newHosts.add(service.hostId);
    const name = service.identity.name ?? "unknown";
    entry.names.set(name, (entry.names.get(name) ?? 0) + 1);
    ports.set(service.port, entry);
  }

  const subnets = new Map<string, { hostsUp: number; ports: Map<number, number>; openPorts: number; order: bigint }>();
  for (const host of up) {
    const cidr = `${host.ip.split(".").slice(0, 3).join(".")}.0/24`;
    const entry = subnets.get(cidr) ?? { hostsUp: 0, ports: new Map(), openPorts: 0, order: host.ipNumber >> 8n };
    entry.hostsUp += 1;
    for (const service of host.services.filter((candidate) => candidate.present)) {
      entry.openPorts += 1;
      entry.ports.set(service.port, (entry.ports.get(service.port) ?? 0) + 1);
    }
    subnets.set(cidr, entry);
  }

  return {
    totals: { hostsUp: up.length, openPorts: services.length, distinctPorts: ports.size },
    ports: [...ports]
      .map(([port, entry]) => ({
        port,
        protocol: "tcp" as const,
        hosts: entry.hosts.size,
        newHosts: entry.newHosts.size,
        services: [...entry.names]
          .map(([name, count]) => ({ name, count }))
          .toSorted((a, b) => b.count - a.count),
      }))
      .toSorted((a, b) => b.hosts - a.hosts || a.port - b.port),
    subnets: [...subnets]
      .toSorted(([, a], [, b]) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
      .map(([cidr, entry]) => ({
        cidr,
        hostsUp: entry.hostsUp,
        openPorts: entry.openPorts,
        topPorts: [...entry.ports]
          .toSorted((a, b) => b[1] - a[1] || a[0] - b[0])
          .slice(0, 5)
          .map(([port]) => port),
      })),
  };
}

function triageItem(service: ReportService): TriageItem {
  return {
    hostId: service.hostId,
    serviceId: service.serviceId,
    ip: service.ip,
    port: service.port,
    identity: service.identity,
    change: service.change,
    triage: service.triage,
    tags: service.tags,
    remediation: service.remediation,
  };
}

const open = (service: ReportService) => service.triage !== "false_positive";
const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
const dayOf = (value: string) => Date.parse(`${value}T00:00:00Z`);

export function triageOf(hosts: readonly ReportHost[], now: Date): Omit<TriageReport, "generatedAt" | "scan"> {
  const up = hosts.filter(isUp);
  const services = presentServices(up);
  const hostCounts = EMPTY_TRIAGE_COUNTS();
  for (const host of up) hostCounts[host.triage] += 1;
  const serviceCounts = EMPTY_TRIAGE_COUNTS();
  for (const service of services) serviceCounts[service.triage] += 1;

  const today = utcDay(now);
  const withDate = (pick: (service: ReportService) => string | null | undefined, test: (day: number) => boolean) =>
    services
      .filter((service) => {
        const value = pick(service);
        return value ? test(dayOf(value)) : false;
      })
      .toSorted((a, b) => dayOf(pick(a) ?? "") - dayOf(pick(b) ?? ""))
      .map(triageItem);

  return {
    hosts: hostCounts,
    services: serviceCounts,
    progress: services.length === 0 ? 1 : (services.length - serviceCounts.unreviewed) / services.length,
    newUnreviewed: services
      .filter((service) => service.change === "new" && service.triage === "unreviewed")
      .map(triageItem),
    important: services.filter((service) => service.triage === "important").map(triageItem),
    remediation: {
      overdue: withDate((service) => (open(service) ? service.remediation?.slaDueOn : null), (day) => day < today),
      dueSoon: withDate(
        (service) => (open(service) ? service.remediation?.slaDueOn : null),
        (day) => day >= today && day <= today + DUE_SOON_DAYS * DAY_MS,
      ),
      riskAcceptanceExpiring: withDate(
        (service) => service.remediation?.riskAcceptedUntil,
        (day) => day >= today && day <= today + RISK_EXPIRING_DAYS * DAY_MS,
      ),
    },
  };
}

const hasTag = (host: ReportHost, tag: string) =>
  host.tags.includes(tag) || host.services.some((service) => service.tags.includes(tag));

function changeCounts(hosts: readonly ReportHost[]): ScanChangeCounts {
  const counts: ScanChangeCounts = {
    hosts: { new: 0, gone: 0, changed: 0, unknown: 0 },
    services: { new: 0, gone: 0, changed: 0 },
  };
  for (const host of hosts) {
    if (host.change === null || host.change === "unchanged") continue;
    counts.hosts[host.change] += 1;
    if (host.change === "unknown") continue;
    for (const service of host.services) {
      if (service.change === "new" || service.change === "gone" || service.change === "changed") {
        counts.services[service.change] += 1;
      }
    }
  }
  return counts;
}

export function tagsOf(
  hosts: readonly ReportHost[],
  tag: string | undefined,
  compared: boolean,
  now: Date,
): Omit<TagsReport, "generatedAt" | "scan"> {
  const findingsByHost = new Map(
    hosts.map((host) => [
      host.hostId,
      countSeverities(
        host.status === "up"
          ? host.services.filter((service) => service.present).flatMap((service) => findingsFor(service, now))
          : [],
      ),
    ]),
  );
  const tags = new Map<string, { hosts: Set<string>; services: number; changed: Set<string> }>();
  for (const host of hosts) {
    const all = new Set([...host.tags, ...host.services.flatMap((service) => service.tags)]);
    for (const name of all) {
      const entry = tags.get(name) ?? { hosts: new Set(), services: 0, changed: new Set() };
      entry.hosts.add(host.hostId);
      entry.services += host.services.filter((service) => service.tags.includes(name)).length;
      if (host.change !== null && host.change !== "unchanged") entry.changed.add(host.hostId);
      tags.set(name, entry);
    }
  }

  const selectedHosts = tag ? hosts.filter((host) => hasTag(host, tag)) : [];
  return {
    tags: [...tags]
      .map(([name, entry]) => {
        const findings = EMPTY_SEVERITY_COUNTS();
        for (const hostId of entry.hosts) {
          const counts = findingsByHost.get(hostId);
          if (!counts) continue;
          for (const severity of ["high", "medium", "low", "info"] as const) findings[severity] += counts[severity];
        }
        return {
          tag: name,
          hosts: entry.hosts.size,
          services: entry.services,
          changedHosts: entry.changed.size,
          findings,
        };
      })
      .toSorted((a, b) => b.hosts - a.hosts || a.tag.localeCompare(b.tag)),
    selected: tag
      ? {
          tag,
          changes: compared ? changeCounts(selectedHosts) : null,
          hosts: selectedHosts.map(
            (host): TagReportHost => ({
              hostId: host.hostId,
              ip: host.ip,
              hostnames: host.hostnames,
              status: host.status,
              change: host.change,
              triage: host.triage,
              tags: host.tags,
              findings: findingsByHost.get(host.hostId) ?? EMPTY_SEVERITY_COUNTS(),
              services: host.services.map((service) => ({
                serviceId: service.serviceId,
                port: service.port,
                identity: service.identity,
                change: service.change,
                triage: service.triage,
                tags: service.tags,
              })),
            }),
          ),
        }
      : null,
  };
}

function findingsOf(hosts: readonly ReportHost[], now: Date): Omit<FindingsReport, "generatedAt" | "scan"> {
  const prioritized = prioritize(hosts, now);
  const findings = prioritized.flatMap((host) => host.findings);
  // A rule can carry several severities: signatures rate their own findings.
  const byRule = new Map<string, { rule: FindingRule; severity: FindingSeverity; count: number }>();
  for (const { rule, severity } of findings) {
    const key = `${rule}|${severity}`;
    const entry = byRule.get(key) ?? { rule, severity, count: 0 };
    byRule.set(key, { ...entry, count: entry.count + 1 });
  }
  return {
    counts: countSeverities(findings),
    byRule: [...byRule.values()]
      .toSorted((a, b) => {
        const order = { high: 0, medium: 1, low: 2, info: 3 } as const;
        return order[a.severity] - order[b.severity] || b.count - a.count;
      }),
    hosts: prioritized,
  };
}

const PhasesSchema = WorkerScanSchema.shape.phasesMs.partial();
const JobCountsSchema = WorkerScanSchema.shape.counts.pick({ httpEndpoints: true, httpRequests: true }).partial();

async function execution(scanId: string): Promise<ScanSummaryReport["execution"]> {
  const results = await prisma.scanJobResult.findMany({
    where: { scanId },
    select: {
      status: true,
      stopReason: true,
      workerId: true,
      workerVersion: true,
      nmapVersion: true,
      phasesMs: true,
      counts: true,
    },
  });
  const workers = new Map<string, { id: string; version: string; nmapVersion: string | null }>();
  const reasons = new Map<string, number>();
  const phasesMs = { hostDiscovery: 0, portScan: 0, serviceDetection: 0, http: 0 };
  let httpEndpoints = 0;
  let httpRequests = 0;
  for (const result of results) {
    workers.set(`${result.workerId} ${result.workerVersion}`, {
      id: result.workerId,
      version: result.workerVersion,
      nmapVersion: result.nmapVersion,
    });
    if (result.stopReason) reasons.set(result.stopReason, (reasons.get(result.stopReason) ?? 0) + 1);
    const phases = PhasesSchema.safeParse(result.phasesMs).data ?? {};
    phasesMs.hostDiscovery += phases.hostDiscovery ?? 0;
    phasesMs.portScan += phases.portScan ?? 0;
    phasesMs.serviceDetection += phases.serviceDetection ?? 0;
    phasesMs.http += phases.http ?? 0;
    const counts = JobCountsSchema.safeParse(result.counts).data ?? {};
    httpEndpoints += counts.httpEndpoints ?? 0;
    httpRequests += counts.httpRequests ?? 0;
  }
  return {
    results: results.length,
    partialResults: results.filter((result) => result.status === "partial").length,
    failedResults: results.filter((result) => result.status === "failed").length,
    stopReasons: [...reasons].map(([reason, count]) => ({ reason, count })),
    workers: [...workers.values()],
    phasesMs,
    httpEndpoints,
    httpRequests,
  };
}

const portsOf = (host: ReportHost) => host.services.map((service) => service.port);

export const scanReportsService = {
  async findings(scanId: string): Promise<FindingsReport> {
    const { scan, hosts, now } = await load(scanId);
    return { generatedAt: now.toISOString(), scan: toReportScan(scan), ...findingsOf(hosts, now) };
  },

  async technologies(scanId: string): Promise<TechnologiesReport> {
    const { scan, hosts, now } = await load(scanId);
    const services = presentServices(hosts);
    return {
      generatedAt: now.toISOString(),
      scan: toReportScan(scan),
      technologies: inventory(services),
      groups: serviceGroups(services),
    };
  },

  async exposure(scanId: string): Promise<ExposureReport> {
    const { scan, hosts, now } = await load(scanId);
    return { generatedAt: now.toISOString(), scan: toReportScan(scan), ...exposureOf(hosts) };
  },

  async triage(scanId: string): Promise<TriageReport> {
    const { scan, hosts, now } = await load(scanId);
    return { generatedAt: now.toISOString(), scan: toReportScan(scan), ...triageOf(hosts, now) };
  },

  async tags(scanId: string, tag: string | undefined): Promise<TagsReport> {
    const { scan, base, hosts, now } = await load(scanId);
    return { generatedAt: now.toISOString(), scan: toReportScan(scan), ...tagsOf(hosts, tag, base !== null, now) };
  },

  async summary(scanId: string): Promise<ScanSummaryReport> {
    const [detail, { hosts, base, now }, executed] = await Promise.all([
      scanResultsService.get(scanId),
      load(scanId),
      execution(scanId),
    ]);
    const findings = findingsOf(hosts, now);
    const exposure = exposureOf(hosts);
    const triage = triageOf(hosts, now);
    const changed = hosts.filter((host) => host.change === "changed");
    return {
      generatedAt: now.toISOString(),
      scan: detail,
      execution: executed,
      findings: findings.counts,
      topHosts: findings.hosts.slice(0, TOP),
      topPorts: exposure.ports.slice(0, TOP).map(({ port, hosts: count }) => ({ port, hosts: count })),
      topTechnologies: inventory(presentServices(hosts))
        .slice(0, TOP)
        .map(({ name, category, hosts: count }) => ({ name, category, hosts: count })),
      triage: { hosts: triage.hosts, services: triage.services },
      changes: base
        ? {
            newHosts: hosts
              .filter((host) => host.change === "new")
              .slice(0, SUMMARY_LIMIT)
              .map((host) => ({ hostId: host.hostId, ip: host.ip, hostnames: host.hostnames, ports: portsOf(host) })),
            goneHosts: hosts
              .filter((host) => host.change === "gone")
              .slice(0, SUMMARY_LIMIT)
              .map((host) => ({ hostId: host.hostId, ip: host.ip, hostnames: host.hostnames, ports: portsOf(host) })),
            changedServices: changed
              .flatMap((host) =>
                host.services
                  .filter((service) => service.change !== "unchanged")
                  .map((service) => ({
                    hostId: host.hostId,
                    ip: host.ip,
                    port: service.port,
                    change: service.change ?? "changed",
                  })),
              )
              .slice(0, SUMMARY_LIMIT),
          }
        : null,
    };
  },
};
