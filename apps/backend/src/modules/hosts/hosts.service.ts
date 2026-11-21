import {
  HOST_HISTORY_LIMIT,
  type HostDetail,
  type HostHistoryEntry,
  type HostListQuery,
  type HostListResponse,
  type ServiceDetail,
  type TriageStatus,
  type UpdateHostBody,
  type UpdateServiceBody,
} from "@subsurf/contracts/hosts/hosts.schema";
import { ipv4ToInt } from "@subsurf/contracts/targets/ipv4";

import { Prisma, type TransportProtocol } from "~backend/generated/prisma/client";
import { encryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import {
  HOST_INCLUDE,
  toHostDetail,
  toHostListItem,
  type ConclusiveObservation,
} from "~backend/modules/hosts/hosts.mapper";

interface SeenWindow {
  id: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const SEEN_WINDOW = { id: true, firstSeenAt: true, lastSeenAt: true } as const;

/** Results may arrive out of order: only ever widen the window, guarded in SQL against races. */
async function widenSeenWindow(
  model: {
    updateMany(args: {
      where: { id: string; firstSeenAt?: { gt: Date }; lastSeenAt?: { lt: Date } };
      data: { firstSeenAt?: Date; lastSeenAt?: Date };
    }): Promise<unknown>;
  },
  row: SeenWindow,
  seenAt: Date,
): Promise<void> {
  if (seenAt < row.firstSeenAt) {
    await model.updateMany({
      where: { id: row.id, firstSeenAt: { gt: seenAt } },
      data: { firstSeenAt: seenAt },
    });
  }
  if (seenAt > row.lastSeenAt) {
    await model.updateMany({
      where: { id: row.id, lastSeenAt: { lt: seenAt } },
      data: { lastSeenAt: seenAt },
    });
  }
}

function searchWhere(term: string): Prisma.HostWhereInput {
  const contains = { contains: term, mode: "insensitive" } as const;
  const or: Prisma.HostWhereInput[] = [
    { ip: { startsWith: term } },
    { tags: { has: term } },
    { observations: { some: { hostnames: { some: { name: contains } } } } },
    {
      services: {
        some: {
          OR: [
            { nameOverride: contains },
            { productOverride: contains },
            {
              observations: {
                some: { OR: [{ serviceName: contains }, { serviceProduct: contains }] },
              },
            },
          ],
        },
      },
    },
  ];
  if (/^\d{1,5}$/.test(term)) {
    or.push({ services: { some: { port: Number(term) } } });
  }
  return { OR: or };
}

function listWhere(query: HostListQuery): Prisma.HostWhereInput {
  const and: Prisma.HostWhereInput[] = [];
  const term = query.q?.trim();
  if (term) and.push(searchWhere(term));
  if (query.triage) {
    and.push({ OR: [{ triage: query.triage }, { services: { some: { triage: query.triage } } }] });
  }
  return { AND: and };
}

/** `down` observations carry no hostId, so the newest answer per address is looked up by IP. */
async function newestConclusive(ips: string[]): Promise<Map<string, ConclusiveObservation>> {
  const rows = await prisma.hostObservation.findMany({
    where: { ip: { in: ips }, status: { in: ["up", "down"] } },
    orderBy: { scan: { createdAt: "desc" } },
    select: { ip: true, status: true, observedAt: true },
  });
  const newest = new Map<string, ConclusiveObservation>();
  for (const row of rows) {
    if (!newest.has(row.ip) && (row.status === "up" || row.status === "down")) {
      newest.set(row.ip, { status: row.status, observedAt: row.observedAt });
    }
  }
  return newest;
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

function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()))];
}

/** Only the fields present in the body change; an empty note is stored as null. */
function userFields(body: { note?: string; tags?: string[]; triage?: TriageStatus }) {
  return {
    ...(body.note !== undefined && { note: encryptText(body.note.trim()) ?? Prisma.DbNull }),
    ...(body.tags !== undefined && { tags: normalizeTags(body.tags) }),
    ...(body.triage !== undefined && { triage: body.triage }),
  };
}

const override = (value: string | null | undefined) =>
  value === undefined ? undefined : (value?.trim() ?? null);

/**
 * Host and Service rows live across scans. Ingest only creates them and moves their seen
 * window; `note`, `tags`, `triage` and the service corrections belong to users (PDF item 14)
 * and only `update`/`updateService` write them.
 */
export const hostsService = {
  async list(query: HostListQuery): Promise<HostListResponse> {
    const where = listWhere(query);
    const [total, hosts] = await Promise.all([
      prisma.host.count({ where }),
      prisma.host.findMany({
        where,
        orderBy: { ipNumber: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: HOST_INCLUDE,
      }),
    ]);
    const conclusive = await newestConclusive(hosts.map((host) => host.ip));
    return {
      items: hosts.map((host) => toHostListItem(host, conclusive.get(host.ip))),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  },

  async get(id: string): Promise<HostDetail> {
    const host = await prisma.host.findUnique({ where: { id }, include: HOST_INCLUDE });
    if (!host) throw HttpError.notFound("Host not found");
    const [conclusive, entries] = await Promise.all([
      newestConclusive([host.ip]),
      history(host.ip),
    ]);
    return toHostDetail(host, conclusive.get(host.ip), entries);
  },

  async update(id: string, body: UpdateHostBody): Promise<HostDetail> {
    const { count } = await prisma.host.updateMany({ where: { id }, data: userFields(body) });
    if (count === 0) throw HttpError.notFound("Host not found");
    return this.get(id);
  },

  async updateService(
    hostId: string,
    serviceId: string,
    body: UpdateServiceBody,
  ): Promise<ServiceDetail> {
    const { count } = await prisma.service.updateMany({
      where: { id: serviceId, hostId },
      data: {
        ...userFields(body),
        nameOverride: override(body.nameOverride),
        productOverride: override(body.productOverride),
        versionOverride: override(body.versionOverride),
      },
    });
    if (count === 0) throw HttpError.notFound("Service not found");
    const host = await this.get(hostId);
    const service = host.services.find((candidate) => candidate.id === serviceId);
    if (!service) throw HttpError.notFound("Service not found");
    return service;
  },

  /** Records an address seen `up`; returns the Host id. */
  async recordHostUp(tx: Prisma.TransactionClient, ip: string, seenAt: Date): Promise<string> {
    const host = await tx.host.upsert({
      where: { ip },
      create: { ip, ipNumber: BigInt(ipv4ToInt(ip)), firstSeenAt: seenAt, lastSeenAt: seenAt },
      update: {},
      select: SEEN_WINDOW,
    });
    await widenSeenWindow(tx.host, host, seenAt);
    return host.id;
  },

  /** Records a port seen open on a host; returns the Service id. */
  async recordServiceOpen(
    tx: Prisma.TransactionClient,
    hostId: string,
    protocol: TransportProtocol,
    port: number,
    seenAt: Date,
  ): Promise<string> {
    const service = await tx.service.upsert({
      where: { hostId_protocol_port: { hostId, protocol, port } },
      create: { hostId, protocol, port, firstSeenAt: seenAt, lastSeenAt: seenAt },
      update: {},
      select: SEEN_WINDOW,
    });
    await widenSeenWindow(tx.service, service, seenAt);
    return service.id;
  },
};
