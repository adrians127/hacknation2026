import { ipv4ToInt } from "@subsurf/contracts/targets/ipv4";

import type { Prisma, TransportProtocol } from "~backend/generated/prisma/client";

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

/**
 * Host and Service rows live across scans. Ingest only creates them and moves their seen
 * window; `note` and `tags` belong to users (PDF item 14) and are never written here.
 */
export const hostsService = {
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
