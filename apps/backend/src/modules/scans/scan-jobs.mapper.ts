import { z } from "zod";

import type { ScanJob, ScanStep } from "@subsurf/contracts/scans/scan-jobs.schema";
import type { ScanJobStatus } from "@subsurf/contracts/scans/scans.schema";

import type { ScanJob as ScanJobRow, Scan as ScanRow } from "~backend/generated/prisma/client";
import { readSteps } from "~backend/modules/pipelines/steps";

const NO_JOBS: Record<ScanJobStatus, number> = {
  queued: 0,
  leased: 0,
  completed: 0,
  failed: 0,
  stopped: 0,
};

interface StepJobCount {
  stepIndex: number;
  worker: string;
  status: ScanJobStatus;
  _count: { status: number };
}

/** The scan's steps with their job counts; scans queued before pipelines get one step per worker seen. */
export function toScanSteps(scan: ScanRow, counts: readonly StepJobCount[]): ScanStep[] {
  const snapshot = readSteps(scan.steps);
  const steps: ScanStep[] =
    snapshot.length > 0
      ? snapshot.map((step) => ({
          index: step.index,
          worker: step.worker,
          input: step.input,
          ports: step.ports,
          rate: step.rate,
          jobs: { ...NO_JOBS },
        }))
      : [...new Map(counts.map((row) => [row.stepIndex, row.worker]))].map(([index, worker]) => ({
          index,
          worker,
          input: "targets" as const,
          ports: scan.ports,
          rate: scan.maxRate,
          jobs: { ...NO_JOBS },
        }));
  for (const row of counts) {
    const step = steps.find((candidate) => candidate.index === row.stepIndex);
    if (step) step.jobs[row.status] += row._count.status;
  }
  return steps.toSorted((a, b) => a.index - b.index);
}

const JobErrorSchema = z.object({ code: z.string(), message: z.string() });

function jobError(stored: unknown): ScanJob["error"] {
  if (stored === null) return null;
  const parsed = JobErrorSchema.safeParse(stored);
  return parsed.success ? parsed.data : { code: "error", message: "" };
}

export function toScanJob(row: ScanJobRow & { _count: { results: number } }): ScanJob {
  return {
    id: row.id,
    sequence: row.sequence,
    stepIndex: row.stepIndex,
    worker: row.worker,
    kind: row.kind,
    status: row.status,
    subnet: row.subnet,
    addressCount: row.addressCount,
    attempts: row.attempts,
    leasedBy: row.leasedBy,
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMs: row.durationMs,
    resultCount: row._count.results,
    error: jobError(row.error),
  };
}
