import type { Logger } from "pino";

import type {
  SyncMode,
  SyncTrigger,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { env } from "~backend/config/env";
import { prisma } from "~backend/lib/prisma";
import { rematch } from "~backend/modules/vulnerabilities/matching/matching.service";
import { NewResultsWatcher } from "~backend/modules/vulnerabilities/matching/new-results";
import type { Fetcher } from "~backend/modules/vulnerabilities/sources/fetcher";
import { ensureSources, sourceById } from "~backend/modules/vulnerabilities/sources/registry";
import type { VulnerabilitySource } from "~backend/modules/vulnerabilities/sources/source";
import {
  acquireLease,
  LEASE_RENEW_MS,
  releaseLease,
  renewLease,
} from "~backend/modules/vulnerabilities/sync/lease";
import {
  markInterruptedRuns,
  runSync,
  type SyncOutcome,
} from "~backend/modules/vulnerabilities/sync/sync.service";

const HOUR_MS = 60 * 60 * 1000;

export interface Schedule {
  incrementalEveryMs: number;
  fullEveryMs: number;
}

export const DEFAULT_SCHEDULE: Schedule = {
  incrementalEveryMs: env.VULN_SYNC_INTERVAL_HOURS * HOUR_MS,
  fullEveryMs: env.VULN_FULL_SYNC_INTERVAL_DAYS * 24 * HOUR_MS,
};

interface SourceTimes {
  lastIncrementalAt: Date | null;
  lastFullAt: Date | null;
}

/** When each mode is next due: a source with no full sync yet is due now. */
export function dueTimes(source: SourceTimes, schedule: Schedule = DEFAULT_SCHEDULE) {
  const nextFullAt = source.lastFullAt
    ? new Date(source.lastFullAt.getTime() + schedule.fullEveryMs)
    : new Date(0);
  const nextIncrementalAt = source.lastIncrementalAt
    ? new Date(source.lastIncrementalAt.getTime() + schedule.incrementalEveryMs)
    : nextFullAt;
  return { nextFullAt, nextIncrementalAt };
}

export function dueMode(
  source: SourceTimes,
  now: Date,
  schedule = DEFAULT_SCHEDULE,
): SyncMode | null {
  const { nextFullAt, nextIncrementalAt } = dueTimes(source, schedule);
  if (nextFullAt <= now) return "full";
  if (nextIncrementalAt <= now) return "incremental";
  return null;
}

export interface SchedulerOptions {
  holder: string;
  fetcher: Fetcher;
  log: Logger;
  schedule?: Schedule;
}

/**
 * The vuln-sync process's work: requests from the API first, then syncs that are due, then the
 * services of new scan results. Holds the lease while it works and renews it in the background.
 */
export class VulnerabilityScheduler {
  private readonly watcher: NewResultsWatcher;
  private holding = false;

  constructor(private readonly options: SchedulerOptions) {
    this.watcher = new NewResultsWatcher(options.holder, options.log);
  }

  /** Syncs one source (a full sync when incremental cannot catch up), then re-matches. */
  async syncSource(
    source: VulnerabilitySource,
    mode: SyncMode,
    trigger: SyncTrigger,
    signal: AbortSignal,
  ): Promise<SyncOutcome> {
    const base = {
      source,
      trigger,
      holder: this.options.holder,
      fetcher: this.options.fetcher,
      signal,
      log: this.options.log,
    };
    let outcome = await runSync({ ...base, mode });
    if (outcome.needsFull) outcome = await runSync({ ...base, mode: "full" });
    if (outcome.status === "succeeded" || outcome.stats.upserted > 0) {
      const stats = await rematch("all", this.options.log);
      outcome = {
        ...outcome,
        stats: {
          ...outcome.stats,
          matchesAdded: stats.added,
          matchesRetracted: stats.retracted,
          matchesReactivated: stats.reactivated,
        },
      };
      await prisma.vulnerabilitySyncRun.update({
        where: { id: outcome.runId },
        data: { stats: outcome.stats },
      });
    }
    return outcome;
  }

  private async handleRequests(signal: AbortSignal): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      const request = await prisma.vulnerabilityJobRequest.findFirst({
        where: { takenAt: null },
        orderBy: { createdAt: "asc" },
      });
      if (!request) return;
      await prisma.vulnerabilityJobRequest.update({
        where: { id: request.id },
        data: { takenAt: new Date() },
      });
      if (request.kind === "rematch" || request.sourceId === null) {
        // Requests queued meanwhile are covered by this run.
        await prisma.vulnerabilityJobRequest.updateMany({
          where: { kind: "rematch", takenAt: null },
          data: { takenAt: new Date() },
        });
        const stats = await rematch("all", this.options.log);
        this.options.log.info(stats, "Services re-matched on request");
        continue;
      }
      const source = sourceById(request.sourceId);
      const row = await prisma.vulnerabilitySource.findUnique({ where: { id: request.sourceId } });
      if (!source || !row?.enabled) continue;
      await this.syncSource(
        source,
        request.kind === "full_sync" ? "full" : "incremental",
        "manual",
        signal,
      );
    }
  }

  private async handleDue(signal: AbortSignal): Promise<void> {
    const rows = await prisma.vulnerabilitySource.findMany({ where: { enabled: true } });
    for (const row of rows) {
      signal.throwIfAborted();
      const source = sourceById(row.id);
      const mode = source ? dueMode(row, new Date(), this.options.schedule) : null;
      if (source && mode) await this.syncSource(source, mode, "schedule", signal);
    }
  }

  /** One pass of work, if this process gets the lease. `false` = another process holds it. */
  async tick(signal: AbortSignal): Promise<boolean> {
    if (!(await acquireLease(this.options.holder))) {
      this.holding = false;
      return false;
    }
    if (!this.holding) {
      this.holding = true;
      await ensureSources();
      const interrupted = await markInterruptedRuns();
      if (interrupted > 0) this.options.log.warn({ interrupted }, "Runs of a previous process");
    }
    await this.handleRequests(signal);
    await this.handleDue(signal);
    await this.watcher.poll();
    return true;
  }

  /** Works until `signal` aborts; a lost lease aborts the current run. */
  async run(signal: AbortSignal): Promise<void> {
    const pollMs = env.VULN_SYNC_POLL_SECONDS * 1000;
    while (!signal.aborted) {
      const work = new AbortController();
      const stop = () => work.abort(signal.reason);
      signal.addEventListener("abort", stop, { once: true });
      const heartbeat = setInterval(() => {
        renewLease(this.options.holder)
          .then((held) => {
            if (!held && this.holding) {
              this.options.log.warn("Lost the vulnerability sync lease");
              work.abort(new Error("Lease lost"));
            }
          })
          .catch((error: unknown) =>
            this.options.log.error({ err: error }, "Lease renewal failed"),
          );
      }, LEASE_RENEW_MS);
      try {
        await this.tick(work.signal);
      } catch (error) {
        if (!work.signal.aborted) {
          this.options.log.error({ err: error }, "Vulnerability sync failed");
        }
      } finally {
        clearInterval(heartbeat);
        signal.removeEventListener("abort", stop);
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, pollMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve(undefined);
          },
          { once: true },
        );
      });
    }
    await releaseLease(this.options.holder);
  }
}
