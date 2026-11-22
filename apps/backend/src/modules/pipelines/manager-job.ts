import { SignatureProbePathSchema } from "@subsurf/contracts/signatures/signatures.schema";
import { randomUUID } from "node:crypto";

import type { ManagerJob } from "@subsurf/contracts/workers/workers.schema";

import { env } from "~backend/config/env";
import type { Scan, ScanJob } from "~backend/generated/prisma/client";
import { hostTargets, jobParams, readSteps, type ScanStepSnapshot } from "~backend/modules/pipelines/steps";

/** worker-manager wants whole seconds in UTC (`2026-11-21T17:30:00Z`). */
export function utcSeconds(time: Date): string {
  return new Date(Math.floor(time.getTime() / 1000) * 1000).toISOString().replace(".000Z", "Z");
}

/** The step a job belongs to; jobs queued before pipelines get one built from their scan. */
export function jobStep(job: ScanJob, scan: Scan): ScanStepSnapshot {
  const step = readSteps(scan.steps).find((candidate) => candidate.index === job.stepIndex);
  if (step) return step;
  return {
    index: job.stepIndex,
    workerId: null,
    worker: job.worker,
    acceptsHosts: false,
    input: "targets",
    ports: scan.ports,
    rate: scan.maxRate,
    batchSize: scan.batchSize,
    maxDurationSeconds: 3600,
    split: { strategy: "none" },
    params: {},
  };
}

export interface JobLease {
  leaseId: string;
  deadline: Date;
  expiresAt: Date;
  job: ManagerJob;
}

/**
 * Leases one job: its deadline is the step's max duration from now, cut at the scan's time
 * window, and the lease outlives it by `WORKER_LEASE_GRACE_SECONDS` for the result uploads.
 */
/** Probe paths a worker takes (`probe_paths` in its manifest) and the ones the signatures need. */
export interface SignatureProbes {
  paths: readonly string[];
  maxItems: number;
}

/**
 * The step's own probe paths first (never dropped), then the signatures' ones not already there,
 * up to the field's limit. Paths are checked again: an imported signature passed the same check.
 */
export function mergeProbePaths(own: unknown, probes: SignatureProbes): string[] {
  const kept = Array.isArray(own) ? own.filter((path): path is string => typeof path === "string") : [];
  const added = probes.paths.filter(
    (path) => !kept.includes(path) && SignatureProbePathSchema.safeParse(path).success,
  );
  return [...kept, ...added].slice(0, Math.max(kept.length, Math.min(probes.maxItems, 128)));
}

export function leaseJob(job: ScanJob, scan: Scan, now: Date, probes?: SignatureProbes): JobLease {
  const step = jobStep(job, scan);
  const ownDeadline = now.getTime() + step.maxDurationSeconds * 1000;
  const deadline = new Date(Math.min(ownDeadline, scan.windowEndsAt?.getTime() ?? ownDeadline));
  const expiresAt = new Date(deadline.getTime() + env.WORKER_LEASE_GRACE_SECONDS * 1000);
  const leaseId = randomUUID();

  const stored = job.params;
  const params: Record<string, unknown> =
    stored !== null && typeof stored === "object" && !Array.isArray(stored) && "targets" in stored
      ? { ...stored }
      : {
          ...jobParams(
            step,
            step.acceptsHosts ? [...job.targets, ...hostTargets(readHosts(job.hosts))] : job.targets,
          ),
        };
  params.max_duration_seconds = Math.max(1, Math.floor((deadline.getTime() - now.getTime()) / 1000));
  // At lease time, so queued and re-leased jobs follow the signatures as they are now.
  if (probes) params.probe_paths = mergeProbePaths(params.probe_paths, probes);

  const { strategy, maxTasks, maxItemsPerTask } = step.split;
  return {
    leaseId,
    deadline,
    expiresAt,
    job: {
      job_id: job.id,
      scan_id: job.scanId,
      lease_id: leaseId,
      lease_expires_at: utcSeconds(expiresAt),
      deadline: utcSeconds(deadline),
      worker: job.worker,
      split: {
        strategy,
        ...(maxTasks === undefined ? {} : { max_tasks: maxTasks }),
        ...(maxItemsPerTask === undefined ? {} : { max_items_per_task: maxItemsPerTask }),
      },
      params,
    },
  };
}

function readHosts(stored: unknown): { ip: string; domain: string }[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(
    (host): host is { ip: string; domain: string } =>
      typeof host === "object" && host !== null && "ip" in host && "domain" in host,
  );
}
