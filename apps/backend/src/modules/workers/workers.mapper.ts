import {
  SplitStrategySchema,
  WorkerInputSchema,
  WorkerParamFieldsSchema,
  WorkerParamsSchema,
  type SplitStrategy,
  type WorkerInput,
  type WorkerParamField,
  type WorkerParams,
} from "@subsurf/contracts/workers/worker-catalog";
import type { Worker, WorkerManager } from "@subsurf/contracts/workers/worker-registry.schema";

import type {
  Worker as WorkerRow,
  WorkerManager as WorkerManagerRow,
} from "~backend/generated/prisma/client";

/** A manager that asked for work within this long is online. */
export const MANAGER_ONLINE_MS = 2 * 60_000;

export const isManagerOnline = (manager: WorkerManagerRow, now: Date) =>
  now.getTime() - manager.lastSeenAt.getTime() <= MANAGER_ONLINE_MS;

// The JSON and array columns only ever hold what the service validated; anything else reads as empty.
export function workerFields(row: WorkerRow): WorkerParamField[] {
  const parsed = WorkerParamFieldsSchema.safeParse(row.paramFields);
  return parsed.success ? parsed.data : [];
}

export function workerDefaults(row: WorkerRow): WorkerParams {
  const parsed = WorkerParamsSchema.safeParse(row.defaults);
  return parsed.success ? parsed.data : {};
}

export const workerInputs = (row: WorkerRow): WorkerInput[] =>
  row.inputs.filter((input): input is WorkerInput => WorkerInputSchema.safeParse(input).success);

export const workerSplitStrategies = (row: WorkerRow): SplitStrategy[] =>
  row.splitStrategies.filter(
    (strategy): strategy is SplitStrategy => SplitStrategySchema.safeParse(strategy).success,
  );

export function toWorker(row: WorkerRow, onlineManagers: number): Worker {
  return {
    id: row.id,
    name: row.name,
    displayName: row.displayName,
    description: row.description,
    isBuiltin: row.isBuiltin,
    enabled: row.enabled,
    stage: row.stage,
    inputs: workerInputs(row),
    splitStrategies: workerSplitStrategies(row),
    paramFields: workerFields(row),
    defaults: workerDefaults(row),
    maxRate: row.maxRate,
    onlineManagers,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWorkerManager(row: WorkerManagerRow, now: Date): WorkerManager {
  return {
    id: row.id,
    managerId: row.managerId,
    version: row.version,
    workers: row.workers,
    maxParallel: row.maxParallel,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    isOnline: isManagerOnline(row, now),
  };
}
