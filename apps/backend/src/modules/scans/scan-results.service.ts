import {
  HOST_HISTORY_LIMIT,
  type HostHistoryEntry,
  type ScanDetail,
  type ScanHostDetail,
  type ScanHostListQuery,
  type ScanHostListResponse,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { Scan, ScanHostCounts, ScanJobStatus } from "@subsurf/contracts/scans/scans.schema";

import type { Prisma, Scan as ScanRow } from "~backend/generated/prisma/client";
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

const DIFF_SELECT = {
  ip: true,
  ipNumber: true,
  status: true,
  hostId: true,
  ports: { select: { serviceId: true, protocol: true, port: true, fingerprint: true } },
} as const satisfies Prisma.HostObservationSelect;

const NO_HOSTS: ScanHostCounts = { up: 0, down: 0, timeout: 0, cancelled: 0, failed: 0 };

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

async function hostCounts(scanIds?: string[]): Promise<Map<string, ScanHostCounts>> {
  const rows = await prisma.hostObservation.groupBy({
    by: ["scanId", "status"],
    where: scanIds ? { scanId: { in: scanIds } } : {},
    _count: { status: true },
  });
  const counts = new Map<string, ScanHostCounts>();
  for (const row of rows) {
    const scanCounts = counts.get(row.scanId) ?? { ...NO_HOSTS };
    scanCounts[row.status] = row._count.status;
    counts.set(row.scanId, scanCounts);
  }
  return counts;
}

async function openPortCounts(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ scanId: string; openPorts: number }[]>`
    SELECT ho."scanId", count(*)::int AS "openPorts"
    FROM "PortObservation" po JOIN "HostObservation" ho ON ho.id = po."hostObservationId"
    GROUP BY ho."scanId"`;
  return new Map(rows.map((row) => [row.scanId, row.openPorts]));
}

async function diffWithBase(scan: ScanRow, base: BaseScan | null): Promise<HostDiff[]> {
  const upNow = await prisma.hostObservation.findMany({
    where: { scanId: scan.id, status: "up" },
    select: DIFF_SELECT,
  });
  if (!base) return diffScan(upNow, null);

  const upBefore = await prisma.hostObservation.findMany({
    where: { scanId: base.id, status: "up" },
    select: DIFF_SELECT,
  });
  const stillUp = new Set(upNow.map((host) => host.ip));
  const missing = upBefore.filter((host) => !stillUp.has(host.ip)).map((host) => host.ip);
  const answeredOtherwise =
    missing.length === 0
      ? []
      : await prisma.hostObservation.findMany({
          where: { scanId: scan.id, ip: { in: missing } },
          select: DIFF_SELECT,
        });
  return diffScan([...upNow, ...answeredOtherwise], upBefore);
}

/** LIKE wildcards in user input match literally. */
const likePattern = (term: string) => `%${term.replaceAll(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** Page titles live in the plaintext part of `details`: searched in SQL, within these scans. */
async function hostIdsByTitle(term: string, scanIds: string[]): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ hostId: string }[]>`
    SELECT DISTINCT ho."hostId"
    FROM "PortObservation" po JOIN "HostObservation" ho ON ho.id = po."hostObservationId"
    WHERE ho."scanId" = ANY(${scanIds}::uuid[]) AND ho."hostId" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(po.details -> 'http') AS endpoint
        WHERE endpoint ->> 'title' ILIKE ${likePattern(term)}
      )`;
  return rows.map((row) => row.hostId);
}

async function searchWhere(term: string, scanIds: string[]): Promise<Prisma.HostWhereInput> {
  const contains = { contains: term, mode: "insensitive" } as const;
  const inScans = { hostObservation: { scanId: { in: scanIds } } };
  const or: Prisma.HostWhereInput[] = [
    { ip: { startsWith: term } },
    { tags: { has: term } },
    { observations: { some: { scanId: { in: scanIds }, hostnames: { some: { name: contains } } } } },
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
  const byTitle = await hostIdsByTitle(term, scanIds);
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
  const [hosts, current, before] = await Promise.all([
    prisma.host.findMany({
      where: { id: { in: entries.map((entry) => entry.hostId) } },
      include: { services: true },
    }),
    prisma.hostObservation.findMany({ where: { scanId, ip: { in: ips } }, include: OBSERVATION_INCLUDE }),
    base
      ? prisma.hostObservation.findMany({
          where: { scanId: base.id, ip: { in: ips }, status: "up" },
          include: OBSERVATION_INCLUDE,
        })
      : [],
  ]);
  const hostById = new Map(hosts.map((host) => [host.id, host]));
  const currentByIp = new Map(current.map((row) => [row.ip, row]));
  const baseByIp = new Map(before.map((row) => [row.ip, row]));
  return entries.flatMap((diff) => {
    const host = hostById.get(diff.hostId);
    const observation = currentByIp.get(diff.ip);
    return host && observation
      ? [{ diff, host, current: observation, base: baseByIp.get(diff.ip) }]
      : [];
  });
}

async function history(ip: string): Promise<HostHistoryEntry[]> {
  const rows = await prisma.hostObservation.findMany({
    where: { ip },
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
    const [scans, counts, openPorts] = await Promise.all([
      prisma.scan.findMany({ orderBy: { createdAt: "desc" } }),
      hostCounts(),
      openPortCounts(),
    ]);
    return scans.map((scan) =>
      toScan(scan, counts.get(scan.id) ?? NO_HOSTS, openPorts.get(scan.id) ?? 0),
    );
  },

  async get(id: string): Promise<ScanDetail> {
    const scan = await findScan(id);
    const base = await findBaseScan(scan);
    const [counts, openPorts, jobs, entries] = await Promise.all([
      hostCounts([scan.id]),
      prisma.portObservation.count({ where: { hostObservation: { scanId: scan.id } } }),
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
      ...toScan(scan, counts.get(scan.id) ?? NO_HOSTS, openPorts),
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

    const [current, before] = await Promise.all([
      prisma.hostObservation.findUnique({
        where: { scanId_ip: { scanId: scan.id, ip: host.ip } },
        select: DIFF_SELECT,
      }),
      base
        ? prisma.hostObservation.findFirst({
            where: { scanId: base.id, ip: host.ip, status: "up" },
            select: DIFF_SELECT,
          })
        : null,
    ]);
    const [diff] = current ? diffScan([current], base ? (before ? [before] : []) : null) : [];
    if (!diff) throw HttpError.notFound("The host is not part of this scan");

    const [entry] = await hostsInScan(scan.id, base, [diff]);
    if (!entry) throw HttpError.notFound("The host is not part of this scan");
    return toScanHostDetail(entry, await history(entry.host.ip));
  },
};
