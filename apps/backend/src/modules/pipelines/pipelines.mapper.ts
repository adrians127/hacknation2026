import {
  PipelineSplitSchema,
  ScheduleSchema,
  type Pipeline,
  type PipelineRun,
  type PipelineStepDetail,
} from "@subsurf/contracts/pipelines/pipelines.schema";
import { WorkerParamsSchema } from "@subsurf/contracts/workers/worker-catalog";

import type { Prisma, Scan } from "~backend/generated/prisma/client";
import { readSelector } from "~backend/modules/pipelines/target-selection";

export const PIPELINE_INCLUDE = {
  steps: { include: { worker: true }, orderBy: { position: "asc" } },
} as const satisfies Prisma.PipelineInclude;

export type PipelineRow = Prisma.PipelineGetPayload<{ include: typeof PIPELINE_INCLUDE }>;
type StepRow = PipelineRow["steps"][number];

export function toPipelineRun(scan: Scan): PipelineRun {
  return {
    id: scan.id,
    status: scan.status,
    trigger: scan.trigger,
    createdAt: scan.createdAt.toISOString(),
    startedAt: scan.startedAt?.toISOString() ?? null,
    finishedAt: scan.finishedAt?.toISOString() ?? null,
    windowEndsAt: scan.windowEndsAt?.toISOString() ?? null,
    jobCount: scan.jobCount,
  };
}

function toStep(step: StepRow): PipelineStepDetail {
  const split = PipelineSplitSchema.safeParse(step.split);
  const params = WorkerParamsSchema.safeParse(step.params);
  return {
    position: step.position,
    workerId: step.workerId,
    worker: {
      id: step.worker.id,
      name: step.worker.name,
      displayName: step.worker.displayName,
    },
    input: step.input,
    targets: step.input === "targets" ? readSelector(step.targetSelector) : null,
    ports: step.ports,
    rate: step.rate,
    batchSize: step.batchSize,
    maxDurationSeconds: step.maxDurationSeconds,
    split: split.success ? split.data : { strategy: "none" },
    params: params.success ? params.data : {},
  };
}

export function toPipeline(
  row: PipelineRow,
  runs: { last: Scan | undefined; active: Scan | undefined },
): Pipeline {
  const schedule = ScheduleSchema.safeParse(row.schedule);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    steps: row.steps.map(toStep),
    schedule: schedule.success ? schedule.data : null,
    nextRunAt: row.nextRunAt?.toISOString() ?? null,
    lastRun: runs.last ? toPipelineRun(runs.last) : null,
    activeRun: runs.active ? toPipelineRun(runs.active) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
