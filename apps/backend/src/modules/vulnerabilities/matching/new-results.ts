import type { Logger } from "pino";

import { prisma } from "~backend/lib/prisma";
import {
  rematch,
  type RematchStats,
} from "~backend/modules/vulnerabilities/matching/matching.service";
import {
  readResultCursor,
  writeResultCursor,
} from "~backend/modules/vulnerabilities/sync/lease";

/**
 * `receivedAt` is set when ingest inserts the row, which becomes visible only at commit (up to the
 * 60 s ingest transaction later): look back further than that so no result is skipped.
 */
const OVERLAP_MS = 2 * 60_000;

/**
 * Matches the services of scan results that arrived since the last poll, without touching ingest.
 * Results already handled within the overlap window are remembered, so each is matched once.
 */
export class NewResultsWatcher {
  private readonly handled = new Map<string, number>();

  constructor(
    private readonly holder: string,
    private readonly log: Logger,
  ) {}

  async poll(): Promise<RematchStats | null> {
    const cursor = await readResultCursor();
    const since = new Date((cursor?.getTime() ?? 0) - OVERLAP_MS);
    const results = await prisma.scanJobResult.findMany({
      where: { receivedAt: { gt: since } },
      select: { id: true, receivedAt: true },
    });
    const fresh = results.filter((result) => !this.handled.has(result.id));
    if (fresh.length === 0) return null;

    const services = await prisma.portObservation.findMany({
      where: { hostObservation: { resultId: { in: fresh.map((result) => result.id) } } },
      select: { serviceId: true },
      distinct: ["serviceId"],
    });
    const stats = await rematch(
      services.map((service) => service.serviceId),
      this.log,
    );

    const newest = Math.max(...results.map((result) => result.receivedAt.getTime()));
    for (const result of fresh) this.handled.set(result.id, result.receivedAt.getTime());
    for (const [id, receivedAt] of this.handled) {
      if (receivedAt < newest - OVERLAP_MS) this.handled.delete(id);
    }
    await writeResultCursor(this.holder, new Date(newest));
    this.log.info({ results: fresh.length, ...stats }, "Matched services of new scan results");
    return stats;
  }
}
