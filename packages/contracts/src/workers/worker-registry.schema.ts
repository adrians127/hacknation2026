import { z } from "zod";

import {
  SplitStrategySchema,
  WORKER_MAX_RATE_LIMIT,
  WorkerInputSchema,
  WorkerNameSchema,
  WorkerParamFieldsSchema,
} from "./worker-catalog";

// The registry users manage (`/workers`). The machine protocol of worker-manager is in
// workers.schema.ts.

const RateSchema = z.number().int().min(1).max(WORKER_MAX_RATE_LIMIT);

/** A worker a manager registered. Its capabilities come from the manager; admins own the rest. */
export const WorkerSchema = z.object({
  id: z.uuid(),
  /** The name worker-manager runs it under (`jobs[].worker`). */
  name: WorkerNameSchema,
  displayName: z.string(),
  description: z.string(),
  inputs: z.array(WorkerInputSchema),
  splitStrategies: z.array(SplitStrategySchema),
  paramFields: WorkerParamFieldsSchema,
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

/** Admins edit only how a worker is shown and its rate cap; its capabilities come from managers. */
export const UpdateWorkerBodySchema = z
  .object({
    displayName: DisplayNameSchema,
    description: z.string().max(500),
    maxRate: RateSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

export type Worker = z.infer<typeof WorkerSchema>;
export type WorkerManager = z.infer<typeof WorkerManagerSchema>;
export type WorkerListResponse = z.infer<typeof WorkerListResponseSchema>;
export type UpdateWorkerBody = z.infer<typeof UpdateWorkerBodySchema>;
