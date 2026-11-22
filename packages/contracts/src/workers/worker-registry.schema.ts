import { z } from "zod";

import {
  SplitStrategySchema,
  WORKER_MAX_RATE_LIMIT,
  WorkerInputSchema,
  WorkerNameSchema,
  WorkerParamFieldsSchema,
  WorkerParamsSchema,
} from "./worker-catalog";

// The registry users manage (`/workers`). The machine protocol of worker-manager is in
// workers.schema.ts.

const RateSchema = z.number().int().min(1).max(WORKER_MAX_RATE_LIMIT);

export const WorkerSchema = z.object({
  id: z.uuid(),
  name: WorkerNameSchema,
  displayName: z.string(),
  description: z.string(),
  /** Defined in code: only `enabled`, `defaults` and `maxRate` can change. */
  isBuiltin: z.boolean(),
  enabled: z.boolean(),
  stage: z.number().int(),
  inputs: z.array(WorkerInputSchema),
  splitStrategies: z.array(SplitStrategySchema),
  paramFields: WorkerParamFieldsSchema,
  defaults: WorkerParamsSchema,
  /** Packets per second a step of this worker may use at most. */
  maxRate: RateSchema,
  /** Managers seen recently that offer this worker. */
  onlineManagers: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** A worker-manager instance, as its last lease request described it. */
export const WorkerManagerSchema = z.object({
  id: z.uuid(),
  managerId: z.string(),
  version: z.string(),
  workers: z.array(z.string()),
  maxParallel: z.number().int().nonnegative(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  /** Asked for work within the last two minutes. */
  isOnline: z.boolean(),
});

export const WorkerListResponseSchema = z.object({
  items: z.array(WorkerSchema),
  managers: z.array(WorkerManagerSchema),
});

const DisplayNameSchema = z.string().min(1).max(100).regex(/\S/, "Must not be blank");

/** Custom workers may change every field; built-in ones only `enabled`, `defaults` and `maxRate`. */
export const UpdateWorkerBodySchema = z
  .object({
    enabled: z.boolean(),
    maxRate: RateSchema,
    defaults: WorkerParamsSchema,
    displayName: DisplayNameSchema,
    description: z.string().max(500),
    stage: z.number().int().min(0).max(1000),
    inputs: z.array(WorkerInputSchema).min(1),
    splitStrategies: z.array(SplitStrategySchema).min(1),
    paramFields: WorkerParamFieldsSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

export type Worker = z.infer<typeof WorkerSchema>;
export type WorkerManager = z.infer<typeof WorkerManagerSchema>;
export type WorkerListResponse = z.infer<typeof WorkerListResponseSchema>;
export type UpdateWorkerBody = z.infer<typeof UpdateWorkerBodySchema>;
