import {
  HOST_HISTORY_LIMIT,
  type HostHistoryEntry,
  type ScanDetail,
  type ScanHostDetail,
  type ScanHostListQuery,
  type ScanHostListResponse,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { Scan, ScanHostCounts, ScanJobStatus } from "@subsurf/contracts/scans/scans.schema";

import {
  Prisma,
  type HostObservationStatus,
  type Scan as ScanRow,
} from "~backend/generated/prisma/client";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import {
  countChanges,
  diffScan,
  matchesChange,
  type HostDiff,
} from "~backend/modules/scans/scan-diff";
import {
  OBSERVATION_INCLUDE,
  toScan,
  toScanHost,
  toScanHostDetail,
  type HostInScan,
} from "~backend/modules/scans/scan-results.mapper";
import { EMPTY_SUMMARY } from "~backend/modules/vulnerabilities/vulnerabilities.mapper";
import { vulnerabilitiesService } from "~backend/modules/vulnerabilities/vulnerabilities.service";

const DIFF_SELECT = {
  ip: true,
  ipNumber: true,
  status: true,
  hostId: true,
  ports: { select: { serviceId: true, protocol: true, port: true, fingerprint: true } },
} as const satisfies Prisma.HostObservationSelect;

const NO_HOSTS: ScanHostCounts = { up: 0, down: 0, timeout: 0, cancelled: 0, failed: 0 };

interface ScanSummary {
  hosts: ScanHostCounts;
  openPorts: number;
}

interface EffectiveRow {
  id: string;
  scanId: string;
  ip: string;
  status: HostObservationStatus;
}

/**
 * Store every worker result, but show one observation per IP in a scan.
 * Conclusive answers win; for two "up" answers Nmap's service data wins over
 * discovery data, then the latest observation wins.
 */
function effectiveSql(scanIds: readonly string[], ips?: readonly string[]): Prisma.Sql {
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
      CASE WHEN r."workerId" LIKE 'nmap%' THEN 0 ELSE 1 END,
      h."observedAt" DESC NULLS LAST, r."receivedAt" DESC, h.id DESC
  `;
}

async function effectiveIds(scanIds: readonly string[], ips?: readonly string[]): Promise<string[]> {
  if (scanIds.length === 0 || ips?.length === 0) return [];
  const rows = await prisma.$queryRaw<EffectiveRow[]>(effectiveSql(scanIds, ips));
  return rows.map((row) => row.id);
}

interface BaseScan {
  id: string;
  startedAt: Date | null;
}

async function findScan(id: string): Promise<ScanRow> {
  const scan = await prisma.scan.findUnique({ where: { id } });
  if (!scan) throw HttpError.notFound("Scan not found");
  return scan;
}

/** The previous scan that has results: what "new", "gone" and "changed" are relative to. */
function findBaseScan(scan: ScanRow): Promise<BaseScan | null> {
  return prisma.scan.findFirst({
    where: { createdAt: { lt: scan.createdAt }, results: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true, startedAt: true },
  });
}

async function scanSummaries(scanIds: readonly string[]): Promise<Map<string, ScanSummary>> {
  const summaries = new Map<string, ScanSummary>();
  if (scanIds.length === 0) return summaries;
  const rows = await prisma.$queryRaw<
    { scanId: string; status: HostObservationStatus; hosts: number; openPorts: number }[]
  >`
    WITH effective AS (${effectiveSql(scanIds)})
    SELECT e."scanId", e.status, count(DISTINCT e.id)::int AS hosts,
           count(p.id)::int AS "openPorts"
    FROM effective e
    LEFT JOIN "PortObservation" p ON p."hostObservationId" = e.id
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

async function diffWithBase(scan: ScanRow, base: BaseScan | null): Promise<HostDiff[]> {
  const ids = await effectiveIds(base ? [scan.id, base.id] : [scan.id]);
  const observations = await prisma.hostObservation.findMany({
    where: { id: { in: ids } },
    select: { ...DIFF_SELECT, scanId: true },
  });
  const upNow = observations.filter((host) => host.scanId === scan.id && host.status === "up");
  if (!base) return diffScan(upNow, null);

  const upBefore = observations.filter((host) => host.scanId === base.id && host.status === "up");
  const stillUp = new Set(upNow.map((host) => host.ip));
  const missing = new Set(upBefore.filter((host) => !stillUp.has(host.ip)).map((host) => host.ip));
  const answeredOtherwise =
    missing.size === 0
      ? []
      : observations.filter((host) => host.scanId === scan.id && missing.has(host.ip));
  return diffScan([...upNow, ...answeredOtherwise], upBefore);
}

/** LIKE wildcards in user input match literally. */
const likePattern = (term: string) => `%${term.replaceAll(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** Page titles live in the plaintext part of `details`: searched in SQL, within these scans. */
async function hostIdsByTitle(term: string, observationIds: string[]): Promise<string[]> {
  if (observationIds.length === 0) return [];
  const rows = await prisma.$queryRaw<{ hostId: string }[]>`
    SELECT DISTINCT ho."hostId"
    FROM "PortObservation" po JOIN "HostObservation" ho ON ho.id = po."hostObservationId"
    WHERE ho.id = ANY(${observationIds}::uuid[]) AND ho."hostId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(po.details -> 'http') AS endpoint
        WHERE endpoint ->> 'title' ILIKE ${likePattern(term)}
      )`;
  return rows.map((row) => row.hostId);
}

async function searchWhere(term: string, scanIds: string[]): Promise<Prisma.HostWhereInput> {
  const observationIds = await effectiveIds(scanIds);
  const contains = { contains: term, mode: "insensitive" } as const;
  const inScans = { hostObservation: { id: { in: observationIds } } };
  const or: Prisma.HostWhereInput[] = [
    { ip: { startsWith: term } },
    { tags: { has: term } },
    { observations: { some: { id: { in: observationIds }, hostnames: { some: { name: contains } } } } },
    {
      services: {
        some: {
          OR: [
            { nameOverride: contains },
            { productOverride: contains },
            {
              observations: {
                some: { ...inScans, OR: [{ serviceName: contains }, { serviceProduct: contains }] },
              },
            },
          ],
        },
      },
    },
  ];
  if (/^\d{1,5}$/.test(term)) {
    or.push({ services: { some: { port: Number(term), observations: { some: inScans } } } });
  }
  const byTitle = await hostIdsByTitle(term, observationIds);
  if (byTitle.length > 0) or.push({ id: { in: byTitle } });
  return { OR: or };
}

/** `null` when the query has no host filters. */
async function filteredHostIds(
  query: ScanHostListQuery,
  scanIds: string[],
): Promise<Set<string> | null> {
  const and: Prisma.HostWhereInput[] = [];
  const term = query.q?.trim();
  if (term) and.push(await searchWhere(term, scanIds));
  if (query.triage) {
    and.push({ OR: [{ triage: query.triage }, { services: { some: { triage: query.triage } } }] });
  }
  if (query.vulnerability) {
    and.push({ id: { in: await vulnerabilitiesService.hostIdsWith(query.vulnerability) } });
  }
  if (and.length === 0) return null;
  const hosts = await prisma.host.findMany({ where: { AND: and }, select: { id: true } });
  return new Set(hosts.map((host) => host.id));
}

/** Loads the assets and both scans' observations for the given entries of a diff. */
async function hostsInScan(
  scanId: string,
  base: BaseScan | null,
  entries: readonly HostDiff[],
): Promise<HostInScan[]> {
  const ips = entries.map((entry) => entry.ip);
  if (ips.length === 0) return [];
  const ids = await effectiveIds(base ? [scanId, base.id] : [scanId], ips);
  const shownServices = new Map(
    entries.map((entry) => [entry.hostId, entry.services.map((service) => service.serviceId)]),
  );
  const [hosts, current, before, summaries] = await Promise.all([
    prisma.host.findMany({
      where: { id: { in: entries.map((entry) => entry.hostId) } },
      include: { services: true },
    }),
    prisma.hostObservation.findMany({ where: { scanId, id: { in: ids } }, include: OBSERVATION_INCLUDE }),
    base
      ? prisma.hostObservation.findMany({
          where: { scanId: base.id, id: { in: ids }, status: "up" },
          include: OBSERVATION_INCLUDE,
        })
      : [],
    vulnerabilitiesService.summaries(shownServices),
  ]);
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
            vulnerabilities: {
              host: summaries.groups.get(diff.hostId) ?? EMPTY_SUMMARY,
              services: summaries.services,
            },
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
      _count: { select: { ports: true } },
    },
  });
  return rows.map((row) => ({
    scanId: row.scanId,
    scannedAt: (row.scan.startedAt ?? row.scan.createdAt).toISOString(),
    status: row.status,
    observedAt: row.observedAt?.toISOString() ?? null,
    latencyMs: row.latencyMs,
    openPorts: row._count.ports,
  }));
}

/**
 * Scan results as users browse them: a scan, the hosts it saw and how they changed since the
 * base scan. Read-only; host and service edits go through `hostsService`.
 */
export const scanResultsService = {
  async list(): Promise<Scan[]> {
    const scans = await prisma.scan.findMany({ orderBy: { createdAt: "desc" } });
    const summaries = await scanSummaries(scans.map((scan) => scan.id));
    return scans.map((scan) => {
      const summary = summaries.get(scan.id);
      return toScan(scan, summary?.hosts ?? NO_HOSTS, summary?.openPorts ?? 0);
    });
  },

  async get(id: string): Promise<ScanDetail> {
    const scan = await findScan(id);
    const base = await findBaseScan(scan);
    const [summaries, jobs, entries] = await Promise.all([
      scanSummaries([scan.id]),
      prisma.scanJob.groupBy({ by: ["status"], where: { scanId: scan.id }, _count: { status: true } }),
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
      ports: scan.ports,
      maxRate: scan.maxRate,
      batchSize: scan.batchSize,
      jobs: jobCounts,
      baseScan: base && { id: base.id, startedAt: base.startedAt?.toISOString() ?? null },
      changes: base ? countChanges(entries) : null,
    };
  },

  async listHosts(scanId: string, query: ScanHostListQuery): Promise<ScanHostListResponse> {
    const scan = await findScan(scanId);
    const base = await findBaseScan(scan);
    let entries = await diffWithBase(scan, base);
    const { change } = query;
    if (change) entries = entries.filter((entry) => matchesChange(entry.change, change));
    const ids = await filteredHostIds(query, base ? [scan.id, base.id] : [scan.id]);
    if (ids) entries = entries.filter((entry) => ids.has(entry.hostId));

    const start = (query.page - 1) * query.pageSize;
    const page = await hostsInScan(scan.id, base, entries.slice(start, start + query.pageSize));
    return {
      items: page.map(toScanHost),
      total: entries.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  },

  async getHost(scanId: string, hostId: string): Promise<ScanHostDetail> {
    const scan = await findScan(scanId);
    const base = await findBaseScan(scan);
    const host = await prisma.host.findUnique({ where: { id: hostId }, select: { ip: true } });
    if (!host) throw HttpError.notFound("Host not found");

    const ids = await effectiveIds(base ? [scan.id, base.id] : [scan.id], [host.ip]);
    const observations = await prisma.hostObservation.findMany({
      where: { id: { in: ids } },
      select: { ...DIFF_SELECT, scanId: true },
    });
    const current = observations.find((row) => row.scanId === scan.id);
    const before = observations.find((row) => row.scanId === base?.id && row.status === "up");
    const [diff] = current ? diffScan([current], base ? (before ? [before] : []) : null) : [];
    if (!diff) throw HttpError.notFound("The host is not part of this scan");

    const [entry] = await hostsInScan(scan.id, base, [diff]);
    if (!entry) throw HttpError.notFound("The host is not part of this scan");
    const [entries, matches] = await Promise.all([
      history(entry.host.ip),
      vulnerabilitiesService.details(diff.services.map((service) => service.serviceId)),
    ]);
    return toScanHostDetail(entry, entries, matches);
  },
};
