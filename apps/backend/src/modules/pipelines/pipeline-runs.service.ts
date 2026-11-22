import type { Logger } from "pino";

import {
  PipelineSplitSchema,
  ScheduleSchema,
  TargetSelectorSchema,
  type RunPipelineResponse,
  type TargetSelector,
} from "@subsurf/contracts/pipelines/pipelines.schema";
import { isPortInSpec, portSpecRanges } from "@subsurf/contracts/scans/port-spec";
import type { ScanJobHost } from "@subsurf/contracts/scans/scans.schema";
import { coveringCidr, formatCidr, ipv4ToInt } from "@subsurf/contracts/targets/ipv4";
import { defaultStepParams, WorkerParamsSchema } from "@subsurf/contracts/workers/worker-catalog";

import { env } from "~backend/config/env";
import type { Prisma, ScanJob, ScanStatus } from "~backend/generated/prisma/client";
import { chunks } from "~backend/lib/chunks";
import { HttpError } from "~backend/lib/http-error";
import { logger } from "~backend/lib/logger";
import { prisma } from "~backend/lib/prisma";
import { queueRun } from "~backend/modules/pipelines/queue-run";
import { lastFireAtOrBefore, nextFireAfter } from "~backend/modules/pipelines/schedule";
import { hostTargets, jobParams, readSteps, type ScanStepSnapshot } from "~backend/modules/pipelines/steps";
import { selectTargets, selectorWithin } from "~backend/modules/pipelines/target-selection";
import { resolveDomains } from "~backend/modules/scans/dns";
import { workerDefaults, workerFields, workerInputs } from "~backend/modules/workers/workers.mapper";

export const ACTIVE_SCAN_STATUSES: ScanStatus[] = ["queued", "running", "paused"];
const ENDED_SCAN_STATUSES: ScanStatus[] = ["completed", "stopped", "failed"];

/** A window closing sooner than this is treated as closed: no lease, no fire. */
export const MIN_WINDOW_LEFT_MS = 60_000;
/** A `partial` result that stopped at its deadline this close to the window's end was cut by it. */
const WINDOW_CUT_SLACK_MS = 120_000;
const RUN_TRANSACTION_TIMEOUT_MS = 60_000;

const LEASE_EXPIRED = {
  code: "lease-expired",
  message: "No result arrived before the lease expired",
} as const;

const pipelineInclude = {
  steps: { include: { worker: true }, orderBy: { position: "asc" } },
} as const satisfies Prisma.PipelineInclude;

type PipelineWithSteps = Prisma.PipelineGetPayload<{ include: typeof pipelineInclude }>;

export function readSelector(stored: unknown): TargetSelector {
  const parsed = TargetSelectorSchema.safeParse(stored);
  return parsed.success ? parsed.data : { tags: [], ranges: [] };
}

/** The steps a run starts with: worker defaults merged under the step's own params, rate capped. */
export function snapshotSteps(pipeline: PipelineWithSteps): ScanStepSnapshot[] {
  return pipeline.steps.map((step) => {
    const fields = workerFields(step.worker);
    const split = PipelineSplitSchema.safeParse(step.split);
    const params = WorkerParamsSchema.safeParse(step.params);
    return {
      index: step.position,
      workerId: step.workerId,
      worker: step.worker.name,
      acceptsHosts: workerInputs(step.worker).includes("hosts"),
      input: step.input,
      ports: step.ports,
      rate: Math.min(step.rate, step.worker.maxRate),
      batchSize: step.batchSize,
      maxDurationSeconds: step.maxDurationSeconds,
      split: split.success ? split.data : { strategy: "none" },
      params: {
        ...defaultStepParams(fields, workerDefaults(step.worker)),
        ...(params.success ? params.data : {}),
      },
    };
  });
}

async function loadPipeline(id: string): Promise<PipelineWithSteps> {
  const pipeline = await prisma.pipeline.findUnique({ where: { id }, include: pipelineInclude });
  if (!pipeline) throw HttpError.notFound("Pipeline not found");
  return pipeline;
}

function readJobHosts(stored: unknown): ScanJobHost[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (host): host is ScanJobHost =>
      typeof host === "object" && host !== null && "ip" in host && "domain" in host,
  );
}

/** One job per `batchSize` hosts of the next step, from the up hosts and open ports `job` found. */
async function queueFollowUpJobs(job: ScanJob, leaseId: string, steps: readonly ScanStepSnapshot[]) {
  const next = steps.find((step) => step.index === job.stepIndex + 1);
  if (!next || next.input !== "previous") return;

  const allowed = portSpecRanges(next.ports);
  const observations = await prisma.hostObservation.findMany({
    where: { status: "up", result: { scanJobId: job.id, leaseId } },
    select: { ip: true, ports: { select: { port: true, protocol: true } } },
  });
  // Shards of one job may each report the same address with other ports.
  const portsByIp = new Map<string, Set<number>>();
  for (const observation of observations) {
    const ports = portsByIp.get(observation.ip) ?? new Set<number>();
    for (const { port, protocol } of observation.ports) {
      if (protocol === "tcp" && isPortInSpec(port, allowed)) ports.add(port);
    }
    portsByIp.set(observation.ip, ports);
  }
  const ips = [...portsByIp]
    .filter(([, ports]) => ports.size > 0)
    .map(([ip]) => ip)
    .toSorted((a, b) => ipv4ToInt(a) - ipv4ToInt(b));
  if (ips.length === 0) return;

  const jobHosts = readJobHosts(job.hosts);
  const domains = new Map(hostTargets(jobHosts).map((host) => [host.ip, host.domains]));
  await prisma.$transaction(async (tx) => {
    for (const batch of chunks(ips, next.batchSize)) {
      const { jobCount } = await tx.scan.update({
        where: { id: job.scanId },
        data: { jobCount: { increment: 1 } },
        select: { jobCount: true },
      });
      const kept = new Set(batch);
      const targets = batch.map((ip) => ({
        ip,
        ports: [...(portsByIp.get(ip) ?? [])].toSorted((a, b) => a - b),
        domains: domains.get(ip) ?? [],
      }));
      const first = ipv4ToInt(batch[0]);
      const last = ipv4ToInt(batch.at(-1) ?? batch[0]);
      await tx.scanJob.create({
        data: {
          scanId: job.scanId,
          sequence: jobCount,
          stepIndex: next.index,
          worker: next.worker,
          kind: "service",
          subnet: formatCidr(coveringCidr({ start: first, end: last })),
          targets: batch,
          hosts: jobHosts.filter((host) => kept.has(host.ip)),
          addressCount: batch.length,
          params: jobParams(next, targets),
        },
      });
    }
  });
}

interface FireCandidate {
  id: string;
  name: string;
  createdById: string;
}

export const pipelineRuns = {
  /** "Run now" (no time window) or a schedule's fire. */
  async start(
    pipelineId: string,
    options: { trigger: "manual" | "schedule"; requestedById: string; windowEndsAt: Date | null },
  ): Promise<RunPipelineResponse> {
    const pipeline = await loadPipeline(pipelineId);
    const disabled = pipeline.steps.filter((step) => !step.worker.enabled);
    if (disabled.length > 0) {
      const names = disabled.map((step) => step.worker.name).join(", ");
      throw HttpError.conflict(`Disabled worker: ${names}`, "WORKER_DISABLED");
    }
    const selector = readSelector(pipeline.targetSelector);
    const targets = await selectTargets(selector);
    const dns = await resolveDomains(
      targets.filter((target) => target.kind === "domain").map((target) => target.value),
    );

    const result = await prisma.$transaction(
      async (tx) => {
        // Serializes runs of one pipeline, so two "Run now" clicks cannot both pass the check.
        await tx.$queryRaw`SELECT 1 FROM "Pipeline" WHERE id = ${pipelineId}::uuid FOR UPDATE`;
        const active = await tx.scan.count({
          where: { pipelineId, status: { in: ACTIVE_SCAN_STATUSES } },
        });
        if (active > 0) {
          throw HttpError.conflict("A run of this pipeline is still active", "PIPELINE_RUN_ACTIVE");
        }
        const queued = await queueRun(tx, {
          requestedById: options.requestedById,
          pipelineId,
          trigger: options.trigger,
          steps: snapshotSteps(pipeline),
          targets,
          dns,
          within: selectorWithin(selector),
          windowEndsAt: options.windowEndsAt,
        });
        if (queued.scan) {
          await tx.pipeline.update({ where: { id: pipelineId }, data: { lastRunAt: new Date() } });
        }
        return queued;
      },
      { timeout: RUN_TRANSACTION_TIMEOUT_MS },
    );
    if (!result.scan) {
      throw HttpError.conflict("None of the pipeline's targets can be scanned", "NO_SCANNABLE_TARGETS");
    }
    return { scan: result.scan, warnings: result.warnings };
  },

  /** Queued jobs stop at once; leased ones finish their run, then the scan ends. */
  async stop(scanId: string): Promise<void> {
    const scan = await prisma.scan.findUnique({ where: { id: scanId }, select: { status: true } });
    if (!scan) throw HttpError.notFound("Scan not found");
    if (ENDED_SCAN_STATUSES.includes(scan.status)) {
      throw HttpError.conflict("The scan has already ended", "SCAN_NOT_STOPPABLE");
    }
    await prisma.$transaction([
      prisma.scanJob.updateMany({ where: { scanId, status: "queued" }, data: { status: "stopped" } }),
      prisma.scan.update({ where: { id: scanId }, data: { status: "stopped" } }),
    ]);
    await pipelineRuns.finishIfDone(scanId);
  },

  /**
   * Called after each stored result. Once every task of the job's current lease has reported, the
   * job ends: completed (and the next step gets its jobs), re-queued when the time window cut it
   * or every task failed with attempts left, or failed.
   */
  async onResultStored(jobId: string, leaseId: string, taskCount: number, now = new Date()) {
    const job = await prisma.scanJob.findUnique({ where: { id: jobId }, include: { scan: true } });
    if (!job || job.status !== "leased" || job.leaseId !== leaseId) return;
    const results = await prisma.scanJobResult.findMany({
      where: { scanJobId: jobId, leaseId },
      select: { taskIndex: true, status: true, stopReason: true, startedAt: true, finishedAt: true, error: true },
    });
    if (new Set(results.map((result) => result.taskIndex)).size < taskCount) return;

    const { scan } = job;
    const isStopping = scan.status === "stopped";
    const allFailed = results.every((result) => result.status === "failed");
    const cutByWindow =
      scan.windowEndsAt !== null &&
      scan.windowEndsAt.getTime() <= now.getTime() + WINDOW_CUT_SLACK_MS &&
      results.some((result) => result.status === "partial" && result.stopReason === "deadline");
    const startedAt = new Date(Math.min(...results.map((result) => result.startedAt.getTime())));
    const finishedAt = new Date(Math.max(...results.map((result) => result.finishedAt.getTime())));
    const error = results.find((result) => result.error !== null)?.error ?? undefined;
    const requeue = { status: "queued", leaseId: null, leaseExpiresAt: null } as const;

    let data: Prisma.ScanJobUpdateManyMutationInput;
    if (cutByWindow && !isStopping) {
      // The next window runs it again; a window cut is not a failed attempt.
      data = { ...requeue, attempts: { decrement: 1 } };
    } else if (allFailed && !isStopping && job.attempts < env.SCAN_JOB_MAX_ATTEMPTS) {
      data = { ...requeue, error };
    } else {
      data = {
        status: allFailed ? "failed" : "completed",
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        error: allFailed ? error : undefined,
      };
    }
    const updated = await prisma.scanJob.updateMany({
      where: { id: jobId, leaseId, status: "leased" },
      data,
    });
    if (updated.count === 0) return;

    if (data.status === "completed" && !isStopping) {
      await queueFollowUpJobs(job, leaseId, readSteps(scan.steps));
    }
    await pipelineRuns.finishIfDone(scan.id, now);
  },

  /** Ends a scan once no job is queued or leased: stopped, failed (every job), or completed. */
  async finishIfDone(scanId: string, now = new Date()): Promise<void> {
    const scan = await prisma.scan.findUnique({ where: { id: scanId } });
    if (!scan || scan.finishedAt) return;
    const counts = await prisma.scanJob.groupBy({
      by: ["status"],
      where: { scanId },
      _count: { status: true },
    });
    const count = (status: string) => counts.find((row) => row.status === status)?._count.status ?? 0;
    if (count("queued") + count("leased") > 0) return;
    const total = counts.reduce((sum, row) => sum + row._count.status, 0);
    const status: ScanStatus =
      scan.status === "stopped" || count("stopped") > 0
        ? "stopped"
        : total > 0 && count("failed") === total
          ? "failed"
          : "completed";
    await prisma.scan.updateMany({
      where: { id: scanId, finishedAt: null },
      data: { status, finishedAt: now, startedAt: scan.startedAt ?? now },
    });
  },

  /** Leases nobody reported back on: the job is queued again, or failed after too many attempts. */
  async reclaimExpiredLeases(now = new Date()): Promise<number> {
    const expired = await prisma.scanJob.findMany({
      where: { status: "leased", leaseExpiresAt: { lt: now } },
      select: { id: true, scanId: true, attempts: true, leaseId: true, scan: { select: { status: true } } },
    });
    for (const job of expired) {
      const status =
        job.scan.status === "stopped"
          ? "stopped"
          : job.attempts >= env.SCAN_JOB_MAX_ATTEMPTS
            ? "failed"
            : "queued";
      await prisma.scanJob.updateMany({
        where: { id: job.id, status: "leased", leaseId: job.leaseId },
        data: {
          status,
          leaseId: null,
          leaseExpiresAt: null,
          error: LEASE_EXPIRED,
          ...(status === "queued" ? {} : { finishedAt: now }),
        },
      });
    }
    for (const scanId of new Set(expired.map((job) => job.scanId))) {
      await pipelineRuns.finishIfDone(scanId, now);
    }
    return expired.length;
  },

  /** Scans whose time window closed wait for the next one; leased jobs still report back. */
  async pauseClosedWindows(now = new Date()): Promise<number> {
    const closing = await prisma.scan.findMany({
      where: { status: { in: ["queued", "running"] }, windowEndsAt: { lte: now } },
      select: { id: true },
    });
    for (const { id } of closing) {
      await prisma.scan.updateMany({
        where: { id, status: { in: ["queued", "running"] } },
        data: { status: "paused" },
      });
      await pipelineRuns.finishIfDone(id, now);
    }
    return closing.length;
  },

  /**
   * Fires every enabled pipeline whose `nextRunAt` has come. Claiming moves `nextRunAt` forward
   * with a conditional update, so concurrent API instances fire a pipeline once; missed fires
   * collapse into the latest one, and a window that already closed is skipped.
   */
  async fireDuePipelines(now = new Date(), log: Logger = logger): Promise<void> {
    const due = await prisma.pipeline.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      select: { id: true, name: true, createdById: true, nextRunAt: true, schedule: true },
    });
    for (const pipeline of due) {
      const schedule = ScheduleSchema.safeParse(pipeline.schedule);
      const next = schedule.success ? nextFireAfter(schedule.data, now) : null;
      const claimed = await prisma.pipeline.updateMany({
        where: { id: pipeline.id, nextRunAt: pipeline.nextRunAt },
        data: { nextRunAt: next },
      });
      if (claimed.count === 0 || !schedule.success) continue;

      const firedAt = lastFireAtOrBefore(schedule.data, now) ?? now;
      const { windowMinutes } = schedule.data;
      const windowEndsAt =
        windowMinutes === null ? null : new Date(firedAt.getTime() + windowMinutes * 60_000);
      if (windowEndsAt && windowEndsAt.getTime() <= now.getTime() + MIN_WINDOW_LEFT_MS) {
        log.warn({ pipelineId: pipeline.id, firedAt }, "Pipeline fire skipped: its time window already closed");
        continue;
      }
      try {
        const outcome = await pipelineRuns.fire(pipeline, windowEndsAt);
        log.info({ pipelineId: pipeline.id, name: pipeline.name, outcome }, "Pipeline schedule fired");
      } catch (error) {
        log.warn({ pipelineId: pipeline.id, err: error }, "Pipeline schedule could not start a run");
      }
    }
  },

  /** A paused run resumes in the new window; a run still going makes this fire a no-op. */
  async fire(pipeline: FireCandidate, windowEndsAt: Date | null): Promise<"resumed" | "skipped" | "started"> {
    const active = await prisma.scan.findFirst({
      where: { pipelineId: pipeline.id, status: { in: ACTIVE_SCAN_STATUSES } },
      orderBy: { createdAt: "desc" },
    });
    if (active?.status === "paused") {
      await prisma.scan.updateMany({
        where: { id: active.id, status: "paused" },
        data: { status: active.startedAt ? "running" : "queued", windowEndsAt },
      });
      await prisma.pipeline.update({ where: { id: pipeline.id }, data: { lastRunAt: new Date() } });
      return "resumed";
    }
    if (active) return "skipped";
    await pipelineRuns.start(pipeline.id, {
      trigger: "schedule",
      requestedById: pipeline.createdById,
      windowEndsAt,
    });
    return "started";
  },
};
