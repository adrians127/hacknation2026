import type { TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";
import {
  HOST_HISTORY_LIMIT,
  LIFECYCLE_WINDOW,
  type HostHistoryEntry,
  type HostLifecycle,
  type ScanDetail,
  type ScanHostDetail,
  type ScanHostListQuery,
  type ScanHostListResponse,
  type ScanVisualizationHostsResponse,
  type ScanCoverage,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { ScanChangesResponse } from "@subsurf/contracts/scans/scan-changes.schema";
import type {
  ScanJobListQuery,
  ScanJobListResponse,
} from "@subsurf/contracts/scans/scan-jobs.schema";
import type { Scan, ScanHostCounts, ScanJobStatus } from "@subsurf/contracts/scans/scans.schema";
import {
  formatCidr,
  ipv4ToInt,
  mergeRanges,
  rangeToCidrs,
  type Ipv4Range,
} from "@subsurf/contracts/targets/ipv4";

import {
  Prisma,
  type HostObservationStatus,
  type Scan as ScanRow,
} from "~backend/generated/prisma/client";
import { decryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import {
  applyChangeRules,
  type ChangePriorityRule,
  type ChangeRowFacts,
} from "~backend/modules/rules/rule-match";
import { loadChangeRules, ruleNames } from "~backend/modules/rules/rules.repository";
import { hostLifecycle } from "~backend/modules/scans/host-lifecycle";
import { mergeObservations } from "~backend/modules/scans/merge-observations";
import {
  countChanges,
  countCoverage,
  diffScan,
  matchesChange,
  type HostDiff,
} from "~backend/modules/scans/scan-diff";
import {
  OBSERVATION_INCLUDE,
  SCAN_INCLUDE,
  toChangeFacts,
  toScan,
  toScanHost,
  toScanHostDetail,
  type HostInScan,
  type HostRow,
  type ScanWithPipeline,
  type ObservationRow,
} from "~backend/modules/scans/scan-results.mapper";
import { toScanJob, toScanSteps } from "~backend/modules/scans/scan-jobs.mapper";
import { EMPTY_SUMMARY } from "~backend/modules/vulnerabilities/vulnerabilities.mapper";
import { vulnerabilitiesService } from "~backend/modules/vulnerabilities/vulnerabilities.service";

const NO_HOSTS: ScanHostCounts = { up: 0, down: 0, timeout: 0, cancelled: 0, failed: 0 };

export interface ScanSummary {
  hosts: ScanHostCounts;
  openPorts: number;
}

/** One address a scan export lists, with the asset that holds its edits (none unless it was up). */
export interface ExportedHost {
  observation: ObservationRow;
  host: HostRow | undefined;
}

/** One scan as its own observations describe it, for `GET /scans/{id}/export`. */
export interface ScanExport {
  scan: ScanRow;
  counts: ScanSummary;
  /** CIDR blocks holding every address the scan has an observation of. */
  coverage: string[];
  /** Every address that is not `down`, in address order. */
  batches(): AsyncGenerator<ExportedHost[]>;
}

interface EffectiveRow {
  id: string;
  scanId: string;
  ip: string;
  status: HostObservationStatus;
}

/**
 * Store every worker result, but show one observation per IP in a scan.
 * Conclusive answers win; for two "up" answers prefer Nmap, then httpx, then
 * Masscan. The selected row supplies host status, not the complete set of ports.
 */
export function effectiveSql(scanIds: readonly string[], ips?: readonly string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT DISTINCT ON (h."scanId", h.ip) h.id, h."scanId", h.ip, h.status
    FROM "HostObservation" h
    JOIN "ScanJobResult" r ON r.id = h."resultId"
    WHERE h."scanId" IN (${Prisma.join(scanIds)})
      ${ips ? Prisma.sql`AND h.ip IN (${Prisma.join(ips)})` : Prisma.empty}
    ORDER BY h."scanId", h.ip,
      CASE h.status::text
        WHEN 'up' THEN 0
        WHEN 'down' THEN 1
        WHEN 'timeout' THEN 2
        WHEN 'cancelled' THEN 3
        ELSE 4
      END,
      CASE WHEN r."workerId" LIKE 'nmap%' THEN 0
           WHEN r."workerId" LIKE 'httpx%' THEN 1
           WHEN r."workerId" LIKE 'masscan%' THEN 2 ELSE 3 END,
      h."observedAt" DESC NULLS LAST, r."receivedAt" DESC, h.id DESC
  `;
}

/** The latest conclusive observation of each worker stage at each address. */
function stageSql(scanIds: readonly string[], ips?: readonly string[]): Prisma.Sql {
  return Prisma.sql`
    WITH staged AS (
      SELECT h.id, h."scanId", h.ip, h.status, h."observedAt", r."receivedAt",
        CASE WHEN r."workerId" LIKE 'nmap%' THEN 'nmap'
             WHEN r."workerId" LIKE 'httpx%' THEN 'httpx'
             WHEN r."workerId" LIKE 'masscan%' THEN 'masscan'
             ELSE r."workerId" END AS stage
      FROM "HostObservation" h
      JOIN "ScanJobResult" r ON r.id = h."resultId"
      WHERE h."scanId" IN (${Prisma.join(scanIds)})
        ${ips ? Prisma.sql`AND h.ip IN (${Prisma.join(ips)})` : Prisma.empty}
    )
    SELECT DISTINCT ON ("scanId", ip, stage) id, "scanId", ip, status
    FROM staged
    ORDER BY "scanId", ip, stage,
      CASE status::text WHEN 'up' THEN 0 WHEN 'down' THEN 1
           WHEN 'timeout' THEN 2 WHEN 'cancelled' THEN 3 ELSE 4 END,
      "observedAt" DESC NULLS LAST, "receivedAt" DESC, id DESC
  `;
}

export async function effectiveIds(
  scanIds: readonly string[],
  ips?: readonly string[],
): Promise<string[]> {
  if (scanIds.length === 0 || ips?.length === 0) return [];
  const rows = await prisma.$queryRaw<EffectiveRow[]>(effectiveSql(scanIds, ips));
  return rows.map((row) => row.id);
}

async function effectiveObservations(
  scanIds: readonly string[],
  ips?: readonly string[],
): Promise<ObservationRow[]> {
  if (scanIds.length === 0 || ips?.length === 0) return [];
  const [selected, byStage] = await Promise.all([
    prisma.$queryRaw<EffectiveRow[]>(effectiveSql(scanIds, ips)),
    prisma.$queryRaw<EffectiveRow[]>(stageSql(scanIds, ips)),
  ]);
  const ids = [...new Set([...selected, ...byStage].map((row) => row.id))];
  const rows = await prisma.hostObservation.findMany({
    where: { id: { in: ids } },
    include: OBSERVATION_INCLUDE,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return mergeObservations(
    selected.flatMap((row) => (byId.has(row.id) ? [byId.get(row.id)!] : [])),
    byStage.flatMap((row) => (byId.has(row.id) ? [byId.get(row.id)!] : [])),
  );
}

export interface BaseScan {
  id: string;
  startedAt: Date | null;
}

export async function findScan(id: string): Promise<ScanWithPipeline> {
  const scan = await prisma.scan.findUnique({ where: { id }, include: SCAN_INCLUDE });
  if (!scan) throw HttpError.notFound("Scan not found");
  return scan;
}

/**
 * What "new", "gone" and "changed" are relative to: the requested scan, which must be older,
 * or the previous scan that has results.
 */
async function resolveBase(scan: ScanRow, baseId: string | undefined): Promise<BaseScan | null> {
  if (baseId === undefined) {
    return prisma.scan.findFirst({
      where: { createdAt: { lt: scan.createdAt }, results: { some: {} } },
      orderBy: { createdAt: "desc" },
      select: { id: true, startedAt: true },
    });
  }
  const base = await prisma.scan.findUnique({
    where: { id: baseId },
    select: { id: true, startedAt: true, createdAt: true },
  });
  if (!base) throw HttpError.notFound("Base scan not found");
  if (base.createdAt >= scan.createdAt) {
    throw HttpError.badRequest("The base scan must be older than the scan", "BASE_SCAN_NOT_OLDER");
  }
  return { id: base.id, startedAt: base.startedAt };
}

async function scanSummaries(scanIds: readonly string[]): Promise<Map<string, ScanSummary>> {
  const summaries = new Map<string, ScanSummary>();
  if (scanIds.length === 0) return summaries;
  const rows = await prisma.$queryRaw<
    { scanId: string; status: HostObservationStatus; hosts: number; openPorts: number }[]
  >`
    WITH effective AS (${effectiveSql(scanIds)}),
    stages AS (${stageSql(scanIds)}),
    port_counts AS (
      SELECT s."scanId", s.ip, count(DISTINCT (p.protocol, p.port))::int AS ports
      FROM stages s
      JOIN "PortObservation" p ON p."hostObservationId" = s.id
      WHERE s.status = 'up'
      GROUP BY s."scanId", s.ip
    )
    SELECT e."scanId", e.status, count(*)::int AS hosts,
           coalesce(sum(pc.ports), 0)::int AS "openPorts"
    FROM effective e
    LEFT JOIN port_counts pc ON pc."scanId" = e."scanId" AND pc.ip = e.ip
    GROUP BY e."scanId", e.status
  `;
  for (const row of rows) {
    const summary = summaries.get(row.scanId) ?? { hosts: { ...NO_HOSTS }, openPorts: 0 };
    summary.hosts[row.status] = row.hosts;
    summary.openPorts += row.openPorts;
    summaries.set(row.scanId, summary);
  }
  return summaries;
}

interface ScanComparison {
  entries: HostDiff[];
  /** `null` without a base scan. */
  coverage: ScanCoverage | null;
}

async function diffWithBase(scan: ScanRow, base: BaseScan | null): Promise<ScanComparison> {
  const observations = await effectiveObservations(base ? [scan.id, base.id] : [scan.id]);
  const now = observations.filter((host) => host.scanId === scan.id);
  const upNow = now.filter((host) => host.status === "up");
  if (!base) return { entries: diffScan(upNow, null), coverage: null };

  const before = observations.filter((host) => host.scanId === base.id);
  const stillUp = new Set(upNow.map((host) => host.ip));
  const missing = new Set(
    before.filter((host) => host.status === "up" && !stillUp.has(host.ip)).map((host) => host.ip),
  );
  const answeredOtherwise =
    missing.size === 0 ? [] : now.filter((host) => host.status !== "up" && missing.has(host.ip));
  return {
    entries: diffScan([...upNow, ...answeredOtherwise], before),
    coverage: countCoverage(now, before),
  };
}

/** `ranges` sorted and merged (`mergeRanges`). */
function inRanges(ranges: readonly Ipv4Range[], address: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (!range) return false;
    if (address < range.start) high = middle - 1;
    else if (address > range.end) low = middle + 1;
    else return true;
  }
  return false;
}

/** LIKE wildcards in user input match literally. */
const escapeLike = (term: string) => term.replaceAll(/[\\%_]/g, (char) => `\\${char}`);

/**
 * Hosts matching a search term: IP prefix, tag, service correction, or what these scans'
 * effective observations saw (hostname, service name/product, port, HTTP page title).
 * One statement over the effective-observation CTE: handing their ids to Prisma filters
 * exceeds Postgres's 65,535 bind parameters on large scans.
 */
async function hostIdsMatching(term: string, scanIds: readonly string[]): Promise<string[]> {
  const contains = `%${escapeLike(term)}%`;
  const port = /^\d{1,5}$/.test(term) ? Prisma.sql`OR po.port = ${Number(term)}` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH stages AS (${stageSql(scanIds)}),
    observed AS (
      SELECT ho.id, ho."hostId"
      FROM stages s JOIN "HostObservation" ho ON ho.id = s.id
      WHERE s.status = 'up' AND ho."hostId" IS NOT NULL
    )
    SELECT h.id FROM "Host" h
    WHERE h.ip LIKE ${`${escapeLike(term)}%`} OR ${term} = ANY(h.tags)
    UNION
    SELECT s."hostId" FROM "Service" s
    WHERE s."nameOverride" ILIKE ${contains} OR s."productOverride" ILIKE ${contains}
    UNION
    SELECT o."hostId" FROM observed o
    JOIN "HostnameObservation" hn ON hn."hostObservationId" = o.id
    WHERE hn.name ILIKE ${contains}
    UNION
    SELECT o."hostId" FROM observed o
    JOIN "PortObservation" po ON po."hostObservationId" = o.id
    WHERE po."serviceName" ILIKE ${contains} OR po."serviceProduct" ILIKE ${contains} ${port}
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(po.details -> 'http') AS endpoint
        WHERE endpoint ->> 'title' ILIKE ${contains}
      )
  `;
  return rows.map((row) => row.id);
}

async function hostIdsWithTriage(triage: TriageStatus): Promise<string[]> {
  const hosts = await prisma.host.findMany({
    where: { OR: [{ triage }, { services: { some: { triage } } }] },
    select: { id: true },
  });
  return hosts.map((host) => host.id);
}

/**
 * `null` when the query has no host filters. Intersected here rather than in one Prisma
 * query, which would send each id list as bind parameters.
 */
async function filteredHostIds(
  query: ScanHostListQuery,
  scanIds: string[],
): Promise<Set<string> | null> {
  const filters: Promise<string[]>[] = [];
  const term = query.q?.trim();
  if (term) filters.push(hostIdsMatching(term, scanIds));
  if (query.triage) filters.push(hostIdsWithTriage(query.triage));
  if (query.vulnerability) filters.push(vulnerabilitiesService.hostIdsWith(query.vulnerability));
  if (filters.length === 0) return null;
  const [first = [], ...rest] = await Promise.all(filters);
  const others = rest.map((ids) => new Set(ids));
  return new Set(first.filter((id) => others.every((ids) => ids.has(id))));
}

/** Hosts loaded per query when every change is needed: keeps the IP lists well under the bind limit. */
const CHANGES_BATCH = 500;

const scanRef = (scan: { id: string; startedAt: Date | null }) => ({
  id: scan.id,
  startedAt: scan.startedAt?.toISOString() ?? null,
});

/** Scans that did not cover an address, or got no answer, do not count: look further back. */
const LIFECYCLE_SCANS = LIFECYCLE_WINDOW * 3;

/** Addresses per lifecycle query: each one is a bind parameter. */
const LIFECYCLE_BATCH = 10_000;

/** Each address's lifecycle as of `scan`, from its answers in that scan and earlier ones. */
async function lifecycles(
  scan: ScanRow,
  ips: readonly string[],
): Promise<Map<string, HostLifecycle>> {
  if (ips.length === 0) return new Map();
  const scans = await prisma.scan.findMany({
    where: { createdAt: { lte: scan.createdAt }, results: { some: {} } },
    orderBy: { createdAt: "desc" },
    take: LIFECYCLE_SCANS,
    select: { id: true },
  });
  const age = new Map(scans.map((row, index) => [row.id, index]));
  const scanIds = scans.map((row) => row.id);
  const rows: EffectiveRow[] = [];
  for (let start = 0; start < ips.length; start += LIFECYCLE_BATCH) {
    rows.push(
      ...(await prisma.$queryRaw<EffectiveRow[]>(
        effectiveSql(scanIds, ips.slice(start, start + LIFECYCLE_BATCH)),
      )),
    );
  }
  const statuses = new Map<string, HostObservationStatus[]>();
  for (const row of rows.toSorted((a, b) => (age.get(a.scanId) ?? 0) - (age.get(b.scanId) ?? 0))) {
    statuses.set(row.ip, [...(statuses.get(row.ip) ?? []), row.status]);
  }
  return new Map(ips.map((ip) => [ip, hostLifecycle(statuses.get(ip) ?? [])]));
}

/** Loads the assets and both scans' observations for the given entries of a diff. */
async function hostsInScan(
  scan: ScanRow,
  base: BaseScan | null,
  entries: readonly HostDiff[],
): Promise<HostInScan[]> {
  const scanId = scan.id;
  const ips = entries.map((entry) => entry.ip);
  if (ips.length === 0) return [];
  const shownServices = new Map(
    entries.map((entry) => [entry.hostId, entry.services.map((service) => service.serviceId)]),
  );
  const [hosts, observations, summaries, lifecycleByIp, rules] = await Promise.all([
    prisma.host.findMany({
      where: { id: { in: entries.map((entry) => entry.hostId) } },
      include: { services: true },
    }),
    effectiveObservations(base ? [scanId, base.id] : [scanId], ips),
    vulnerabilitiesService.summaries(shownServices),
    lifecycles(scan, ips),
    ruleNames(),
  ]);
  const current = observations.filter((row) => row.scanId === scanId);
  const before = base
    ? observations.filter((row) => row.scanId === base.id && row.status === "up")
    : [];
  const hostById = new Map(hosts.map((host) => [host.id, host]));
  const currentByIp = new Map(current.map((row) => [row.ip, row]));
  const baseByIp = new Map(before.map((row) => [row.ip, row]));
  return entries.flatMap((diff) => {
    const host = hostById.get(diff.hostId);
    const observation = currentByIp.get(diff.ip);
    return host && observation
      ? [
          {
            diff,
            host,
            current: observation,
            base: baseByIp.get(diff.ip),
            lifecycle: lifecycleByIp.get(diff.ip) ?? hostLifecycle([]),
            vulnerabilities: {
              host: summaries.groups.get(diff.hostId) ?? EMPTY_SUMMARY,
              services: summaries.services,
            },
            rules,
          },
        ]
      : [];
  });
}

async function history(ip: string): Promise<HostHistoryEntry[]> {
  const scans = await prisma.hostObservation.findMany({
    where: { ip },
    distinct: ["scanId"],
    select: { scanId: true },
  });
  const ids = await effectiveIds(scans.map((scan) => scan.scanId), [ip]);
  const rows = await prisma.hostObservation.findMany({
    where: { id: { in: ids } },
    orderBy: { scan: { createdAt: "desc" } },
    take: HOST_HISTORY_LIMIT,
    select: {
      scanId: true,
      status: true,
      observedAt: true,
      latencyMs: true,
      scan: { select: { createdAt: true, startedAt: true } },
    },
  });
  const merged = await effectiveObservations(rows.map((row) => row.scanId), [ip]);
  const portsByScan = new Map(merged.map((row) => [row.scanId, row.ports.length]));
  return rows.map((row) => ({
    scanId: row.scanId,
    scannedAt: (row.scan.startedAt ?? row.scan.createdAt).toISOString(),
    status: row.status,
    observedAt: row.observedAt?.toISOString() ?? null,
    latencyMs: row.latencyMs,
    openPorts: portsByScan.get(row.scanId) ?? 0,
  }));
}

/**
 * Scan results as users browse them: a scan, the hosts it saw and how they changed since the
 * base scan. Read-only; host and service edits go through `hostsService`.
 */
export const scanResultsService = {
  /** The newest scan with results, which the dashboard shows. */
  latestWithResults(): Promise<{ id: string } | null> {
    return prisma.scan.findFirst({
      where: { results: { some: {} } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
  },

  /** How many known hosts are unstable or inactive as of the scan. */
  async lifecycleCounts(scanId: string): Promise<{ unstable: number; inactive: number }> {
    const scan = await findScan(scanId);
    const hosts = await prisma.host.findMany({ select: { ip: true } });
    const states = [...(await lifecycles(scan, hosts.map((host) => host.ip))).values()];
    return {
      unstable: states.filter((lifecycle) => lifecycle.state === "unstable").length,
      inactive: states.filter((lifecycle) => lifecycle.state === "inactive").length,
    };
  },

  async list(): Promise<Scan[]> {
    const scans = await prisma.scan.findMany({ orderBy: { createdAt: "desc" }, include: SCAN_INCLUDE });
    const summaries = await scanSummaries(scans.map((scan) => scan.id));
    return scans.map((scan) => {
      const summary = summaries.get(scan.id);
      return toScan(scan, summary?.hosts ?? NO_HOSTS, summary?.openPorts ?? 0);
    });
  },

  async get(id: string, baseId?: string): Promise<ScanDetail> {
    const scan = await findScan(id);
    const base = await resolveBase(scan, baseId);
    const [summaries, jobs, stepJobs, { entries, coverage }] = await Promise.all([
      scanSummaries([scan.id]),
      prisma.scanJob.groupBy({ by: ["status"], where: { scanId: scan.id }, _count: { status: true } }),
      prisma.scanJob.groupBy({
        by: ["stepIndex", "worker", "status"],
        where: { scanId: scan.id },
        _count: { status: true },
      }),
      diffWithBase(scan, base),
    ]);
    const jobCount = (status: ScanJobStatus) =>
      jobs.find((row) => row.status === status)?._count.status ?? 0;
    const jobCounts: Record<ScanJobStatus, number> = {
      queued: jobCount("queued"),
      leased: jobCount("leased"),
      completed: jobCount("completed"),
      failed: jobCount("failed"),
      stopped: jobCount("stopped"),
    };

    return {
      ...toScan(scan, summaries.get(scan.id)?.hosts ?? NO_HOSTS, summaries.get(scan.id)?.openPorts ?? 0),
      note: decryptText(scan.note),
      ports: scan.ports,
      maxRate: scan.maxRate,
      batchSize: scan.batchSize,
      jobs: jobCounts,
      steps: toScanSteps(scan, stepJobs),
      baseScan: base && { id: base.id, startedAt: base.startedAt?.toISOString() ?? null },
      changes: base ? countChanges(entries) : null,
      coverage,
    };
  },

  async listJobs(scanId: string, query: ScanJobListQuery): Promise<ScanJobListResponse> {
    await findScan(scanId);
    const where = {
      scanId,
      ...(query.step === undefined ? {} : { stepIndex: query.step }),
      ...(query.status === undefined ? {} : { status: query.status }),
    };
    const [total, rows] = await Promise.all([
      prisma.scanJob.count({ where }),
      prisma.scanJob.findMany({
        where,
        orderBy: [{ stepIndex: "asc" }, { sequence: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { _count: { select: { results: true } } },
      }),
    ]);
    return { items: rows.map(toScanJob), page: query.page, pageSize: query.pageSize, total };
  },

  async listHosts(scanId: string, query: ScanHostListQuery): Promise<ScanHostListResponse> {
    const scan = await findScan(scanId);
    const base = await resolveBase(scan, query.base);
    let { entries } = await diffWithBase(scan, base);
    const { change } = query;
    if (change) entries = entries.filter((entry) => matchesChange(entry.change, change));
    const ids = await filteredHostIds(query, base ? [scan.id, base.id] : [scan.id]);
    if (ids) entries = entries.filter((entry) => ids.has(entry.hostId));

    const start = (query.page - 1) * query.pageSize;
    const page = await hostsInScan(scan, base, entries.slice(start, start + query.pageSize));
    return {
      items: page.map(toScanHost),
      total: entries.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  },

  /** Only the host identity and current answer; avoids loading services for the whole diagram. */
  async visualizationHosts(scanId: string): Promise<ScanVisualizationHostsResponse> {
    const scan = await findScan(scanId);
    const base = await resolveBase(scan, undefined);
    const current = effectiveSql([scan.id]);
    const rows = base
      ? await prisma.$queryRaw<{ id: string; ip: string; status: HostObservationStatus }[]>(Prisma.sql`
          WITH current_observations AS (${current}),
               base_observations AS (${effectiveSql([base.id])})
          SELECT CASE WHEN c.status = 'up' THEN now."hostId" ELSE previous."hostId" END AS id,
                 c.ip, c.status
          FROM current_observations c
          JOIN "HostObservation" now ON now.id = c.id
          LEFT JOIN base_observations b ON b.ip = c.ip
          LEFT JOIN "HostObservation" previous ON previous.id = b.id
          WHERE (c.status = 'up' AND now."hostId" IS NOT NULL)
             OR (c.status <> 'up' AND b.status = 'up' AND previous."hostId" IS NOT NULL)
          ORDER BY now."ipNumber"
        `)
      : await prisma.$queryRaw<{ id: string; ip: string; status: HostObservationStatus }[]>(Prisma.sql`
          WITH current_observations AS (${current})
          SELECT now."hostId" AS id, c.ip, c.status
          FROM current_observations c
          JOIN "HostObservation" now ON now.id = c.id
          WHERE c.status = 'up' AND now."hostId" IS NOT NULL
          ORDER BY now."ipNumber"
        `);
    return { items: rows };
  },

  /** Every host of the scan (unpaged) with both scans' observations, for an export. */
  async hostsForExport(scanId: string): Promise<{ scan: ScanRow; hosts: HostInScan[] }> {
    const scan = await findScan(scanId);
    const base = await resolveBase(scan, undefined);
    const { entries } = await diffWithBase(scan, base);
    const hosts: HostInScan[] = [];
    for (let start = 0; start < entries.length; start += CHANGES_BATCH) {
      hosts.push(...(await hostsInScan(scan, base, entries.slice(start, start + CHANGES_BATCH))));
    }
    return { scan, hosts };
  },

  /** The scan's effective observation of every address it covered, whatever the base scan saw. */
  async forExport(scanId: string): Promise<ScanExport> {
    const scan = await findScan(scanId);
    const [rows, summaries] = await Promise.all([
      prisma.$queryRaw<EffectiveRow[]>(effectiveSql([scan.id])),
      scanSummaries([scan.id]),
    ]);
    const addresses = rows.map((row) => ({ ...row, address: ipv4ToInt(row.ip) }));
    const listed = addresses
      .filter((row) => row.status !== "down")
      .toSorted((a, b) => a.address - b.address)
      .map((row) => row.ip);
    return {
      scan,
      counts: summaries.get(scan.id) ?? { hosts: { ...NO_HOSTS }, openPorts: 0 },
      coverage: mergeRanges(addresses.map(({ address }) => ({ start: address, end: address })))
        .flatMap(rangeToCidrs)
        .map(formatCidr),
      async *batches() {
        for (let start = 0; start < listed.length; start += CHANGES_BATCH) {
          const ips = listed.slice(start, start + CHANGES_BATCH);
          const [observations, hosts] = await Promise.all([
            effectiveObservations([scan.id], ips),
            prisma.host.findMany({ where: { ip: { in: ips } }, include: { services: true } }),
          ]);
          const hostByIp = new Map(hosts.map((host) => [host.ip, host]));
          yield observations
            .toSorted((a, b) => (a.ipNumber < b.ipNumber ? -1 : a.ipNumber > b.ipNumber ? 1 : 0))
            .map((observation) => ({ observation, host: hostByIp.get(observation.ip) }));
        }
      },
    };
  },

  /**
   * Like `hostsForExport`, compared with `baseScanId` instead of the base scan when given
   * (`null` = compare with nothing). Reports use it for any pair of scans, in either order.
   */
  async hostsForReport(
    scanId: string,
    baseScanId?: string | null,
  ): Promise<{ scan: ScanRow; base: BaseScan | null; hosts: HostInScan[] }> {
    const scan = await findScan(scanId);
    const base =
      baseScanId === undefined
        ? await resolveBase(scan, undefined)
        : baseScanId === null
          ? null
          : await findScan(baseScanId);
    const { entries } = await diffWithBase(scan, base);
    const hosts: HostInScan[] = [];
    for (let start = 0; start < entries.length; start += CHANGES_BATCH) {
      hosts.push(...(await hostsInScan(scan, base, entries.slice(start, start + CHANGES_BATCH))));
    }
    return { scan, base, hosts };
  },

  /** Every change since the base scan, one row each, rated by the built-in rules only. */
  async changeFacts(
    scanId: string,
    baseId?: string,
  ): Promise<Omit<ScanChangesResponse, "items"> & { facts: ChangeRowFacts[] }> {
    const scan = await findScan(scanId);
    const base = await resolveBase(scan, baseId);
    if (!base) return { scan: scanRef(scan), baseScan: null, facts: [] };
    const { entries } = await diffWithBase(scan, base);
    const changed = entries.filter((entry) => entry.change !== null && entry.change !== "unchanged");
    const facts = [];
    for (let start = 0; start < changed.length; start += CHANGES_BATCH) {
      const page = await hostsInScan(scan, base, changed.slice(start, start + CHANGES_BATCH));
      facts.push(...page.flatMap(toChangeFacts));
    }
    return { scan: scanRef(scan), baseScan: scanRef(base), facts };
  },

  /** Every change since the base scan, one row each, rated, then re-rated by the rules (export and dashboard). */
  async changes(
    scanId: string,
    baseId?: string,
    rules?: readonly ChangePriorityRule[],
  ): Promise<ScanChangesResponse> {
    const [{ facts, ...scans }, changeRules] = await Promise.all([
      scanResultsService.changeFacts(scanId, baseId),
      rules ?? loadChangeRules(),
    ]);
    return { ...scans, items: facts.map((row) => applyChangeRules(row, changeRules)) };
  },

  /**
   * The latest `count` scans with results, each compared with the scan with results before it,
   * newest first (fewer when there are not enough scans).
   */
  async recentDiffs(count: number): Promise<HostDiff[][]> {
    const scans = await prisma.scan.findMany({
      where: { results: { some: {} } },
      orderBy: { createdAt: "desc" },
      take: count + 1,
    });
    const diffs: HostDiff[][] = [];
    for (const [index, scan] of scans.entries()) {
      const base = scans[index + 1];
      if (!base) break;
      diffs.push((await diffWithBase(scan, { id: base.id, startedAt: base.startedAt })).entries);
    }
    return diffs;
  },

  /** Host assets the scan lists (gone and unknown included) inside `ranges` (sorted, merged). */
  async hostIdsIn(scanId: string, ranges: readonly Ipv4Range[]): Promise<string[]> {
    const scan = await findScan(scanId);
    const { entries } = await diffWithBase(scan, await resolveBase(scan, undefined));
    return entries
      .filter((entry) => inRanges(ranges, Number(entry.ipNumber)))
      .map((entry) => entry.hostId);
  },

  async getHost(scanId: string, hostId: string, baseId?: string): Promise<ScanHostDetail> {
    const scan = await findScan(scanId);
    const base = await resolveBase(scan, baseId);
    const host = await prisma.host.findUnique({ where: { id: hostId }, select: { ip: true } });
    if (!host) throw HttpError.notFound("Host not found");

    const observations = await effectiveObservations(base ? [scan.id, base.id] : [scan.id], [host.ip]);
    const current = observations.find((row) => row.scanId === scan.id);
    const before = observations.find((row) => row.scanId === base?.id);
    const [diff] = current ? diffScan([current], base ? (before ? [before] : []) : null) : [];
    if (!diff) throw HttpError.notFound("The host is not part of this scan");

    const [entry] = await hostsInScan(scan, base, [diff]);
    if (!entry) throw HttpError.notFound("The host is not part of this scan");
    const [entries, matches] = await Promise.all([
      history(entry.host.ip),
      vulnerabilitiesService.details(diff.services.map((service) => service.serviceId)),
    ]);
    return toScanHostDetail(entry, entries, matches);
  },
};
