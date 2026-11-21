import type {
  HostEdits,
  ServiceEdits,
  TriageStatus,
  UpdateHostBody,
  UpdateServiceBody,
} from "@subsurf/contracts/hosts/hosts.schema";
import { ipv4ToInt } from "@subsurf/contracts/targets/ipv4";

import { Prisma, type TransportProtocol } from "~backend/generated/prisma/client";
import { encryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { toHostEdits, toServiceEdits } from "~backend/modules/hosts/hosts.mapper";

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
  async update(id: string, body: UpdateHostBody): Promise<HostEdits> {
    const { count } = await prisma.host.updateMany({ where: { id }, data: userFields(body) });
    if (count === 0) throw HttpError.notFound("Host not found");
    return toHostEdits(await prisma.host.findUniqueOrThrow({ where: { id } }));
  },

  async updateService(
    hostId: string,
    serviceId: string,
    body: UpdateServiceBody,
  ): Promise<ServiceEdits> {
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
    return toServiceEdits(await prisma.service.findUniqueOrThrow({ where: { id: serviceId } }));
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
