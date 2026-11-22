import type { Logger } from "pino";

import type {
  SyncMode,
  SyncRunStats,
  SyncTrigger,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { env } from "~backend/config/env";
import { Prisma } from "~backend/generated/prisma/client";
import { prisma } from "~backend/lib/prisma";
import type { Fetcher } from "~backend/modules/vulnerabilities/sources/fetcher";
import type {
  NormalizedVulnerability,
  VulnerabilitySource,
} from "~backend/modules/vulnerabilities/sources/source";
import { assertLease } from "~backend/modules/vulnerabilities/sync/lease";
import { BATCH_SIZE, writeBatch } from "~backend/modules/vulnerabilities/sync/records";

export const EMPTY_STATS: SyncRunStats = {
  upserted: 0,
  unchanged: 0,
  withdrawn: 0,
  swept: 0,
  matchesAdded: 0,
  matchesRetracted: 0,
  matchesReactivated: 0,
};

/** Below this many, a sweep is never refused: small scopes legitimately lose a few records. */
const SWEEP_MIN_REFUSED = 25;

export interface SyncOptions {
  source: VulnerabilitySource;
  mode: SyncMode;
  trigger: SyncTrigger;
  /** Lease holder: cursors and sweeps are written only while it holds the lease. */
  holder: string;
  fetcher: Fetcher;
  signal: AbortSignal;
  log: Logger;
  sweepMaxRatio?: number;
}

export interface SyncOutcome {
  runId: string;
  status: "succeeded" | "failed" | "cancelled";
  /** The source cannot sync incrementally: run a full sync next. */
  needsFull: boolean;
  stats: SyncRunStats;
  error: string | null;
}

export class SweepRefusedError extends Error {}

async function sweep(
  sourceId: string,
  scope: string | null,
  completedScopes: readonly string[],
  startedAt: Date,
  maxRatio: number,
): Promise<number> {
  const inScope =
    scope === null
      ? Prisma.sql`TRUE`
      : Prisma.sql`${scope} = ANY("scopes") AND "scopes" <@ ${completedScopes}::text[]`;
  const [counts] = await prisma.$queryRaw<{ total: number; stale: number }[]>`
    SELECT count(*)::int AS total, count(*) FILTER (WHERE "lastSeenAt" < ${startedAt})::int AS stale
    FROM "Vulnerability"
    WHERE "sourceId" = ${sourceId} AND "status" = 'active' AND ${inScope}`;
  if (!counts || counts.stale === 0) return 0;
  if (counts.stale > SWEEP_MIN_REFUSED && counts.stale > counts.total * maxRatio) {
    const where = scope ? ` in ${scope}` : "";
    throw new SweepRefusedError(
      `Refusing to withdraw ${counts.stale} of ${counts.total} records${where} that the full` +
        " sync did not see: the download may be incomplete",
    );
  }
  return prisma.$executeRaw`
    UPDATE "Vulnerability"
    SET "status" = 'withdrawn', "withdrawnAt" = ${startedAt},
        "withdrawReason" = 'removed_from_source', "updatedAt" = ${startedAt}
    WHERE "sourceId" = ${sourceId} AND "status" = 'active' AND "lastSeenAt" < ${startedAt}
      AND ${inScope}`;
}

async function finishRun(runId: string, data: Prisma.VulnerabilitySyncRunUpdateInput) {
  await prisma.vulnerabilitySyncRun.update({ where: { id: runId }, data });
}

/**
 * Runs one sync of a source: streams its events into the database in batches, moves the cursor
 * at checkpoints and, after a complete full run, withdraws records the source no longer has.
 * Re-matching services is the caller's next step.
 */
export async function runSync(options: SyncOptions): Promise<SyncOutcome> {
  const { source, mode, holder, log } = options;
  const startedAt = new Date();
  const sourceRow = await prisma.vulnerabilitySource.findUniqueOrThrow({
    where: { id: source.id },
  });
  const run = await prisma.vulnerabilitySyncRun.create({
    data: { sourceId: source.id, mode, trigger: options.trigger, startedAt, stats: EMPTY_STATS },
  });
  const stats: SyncRunStats = { ...EMPTY_STATS };
  const completedScopes: (string | null)[] = [];
  let batch: NormalizedVulnerability[] = [];
  let needsFull = false;

  const flush = async () => {
    const written = await writeBatch(source.id, batch, startedAt);
    stats.upserted += written.upserted;
    stats.unchanged += written.unchanged;
    stats.withdrawn += written.withdrawn;
    batch = [];
  };

  try {
    const events = source.sync({
      mode,
      cursor: sourceRow.cursor,
      signal: options.signal,
      fetcher: options.fetcher,
      log: log.child({ source: source.id }),
      now: startedAt,
    });
    for await (const event of events) {
      options.signal.throwIfAborted();
      if (event.type === "upsert") {
        batch.push(event.record);
        if (batch.length >= BATCH_SIZE) await flush();
      } else if (event.type === "checkpoint") {
        await flush();
        await assertLease(holder);
        await prisma.vulnerabilitySource.update({
          where: { id: source.id },
          data: { cursor: event.cursor ?? Prisma.DbNull },
        });
      } else if (event.type === "scopeCompleted") {
        await flush();
        completedScopes.push(event.scope);
      } else {
        needsFull = true;
        log.info({ source: source.id, reason: event.reason }, "Incremental sync not possible");
        break;
      }
    }
    await flush();

    if (needsFull) {
      await finishRun(run.id, {
        status: "cancelled",
        finishedAt: new Date(),
        stats,
        error: "A full sync is needed first",
      });
      return { runId: run.id, status: "cancelled", needsFull, stats, error: null };
    }

    if (mode === "full") {
      await assertLease(holder);
      const named = completedScopes.filter((scope): scope is string => scope !== null);
      for (const scope of completedScopes) {
        stats.swept += await sweep(
          source.id,
          scope,
          named,
          startedAt,
          options.sweepMaxRatio ?? env.VULN_SWEEP_MAX_RATIO,
        );
      }
    }

    const finishedAt = new Date();
    await prisma.vulnerabilitySource.update({
      where: { id: source.id },
      data: {
        ...(mode === "full" ? { lastFullAt: startedAt } : {}),
        lastIncrementalAt: startedAt,
        lastSuccessAt: finishedAt,
        lastError: null,
        recordCount: await prisma.vulnerability.count({
          where: { sourceId: source.id, status: "active" },
        }),
      },
    });
    await finishRun(run.id, { status: "succeeded", finishedAt, stats });
    return { runId: run.id, status: "succeeded", needsFull: false, stats, error: null };
  } catch (error) {
    const cancelled = options.signal.aborted;
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error, source: source.id, mode }, "Vulnerability sync failed");
    await finishRun(run.id, {
      status: cancelled ? "cancelled" : "failed",
      finishedAt: new Date(),
      stats,
      error: message,
    });
    await prisma.vulnerabilitySource.update({
      where: { id: source.id },
      data: { lastError: message },
    });
    return {
      runId: run.id,
      status: cancelled ? "cancelled" : "failed",
      needsFull: false,
      stats,
      error: message,
    };
  }
}

/** Runs left `running` by a process that died: their lease has expired. */
export async function markInterruptedRuns(): Promise<number> {
  const { count } = await prisma.vulnerabilitySyncRun.updateMany({
    where: { status: "running" },
    data: { status: "interrupted", finishedAt: new Date() },
  });
  return count;
}
