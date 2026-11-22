import { z } from "zod";

import { NonBlankStringSchema, TagsSchema } from "../common/common.schema";
import { HOST_SELECTORS_MAX, HostSelectorSchema } from "../hosts/host-selectors";
import { PortSpecSchema, QueuedScanSchema, ScanStatusSchema, ScanTriggerSchema } from "../scans/scans.schema";
import { ImportWarningSchema } from "../targets/targets.schema";
import {
  SplitStrategySchema,
  WORKER_MAX_RATE_LIMIT,
  WorkerParamsSchema,
} from "../workers/worker-catalog";

export const PIPELINE_MAX_STEPS = 8;

/** Addresses per job: powers of two, as `SCAN_BATCH_SIZE`. */
export const PIPELINE_BATCH_SIZES = [16, 32, 64, 128, 256, 512, 1024] as const;

/** One week, the longest `max_duration_seconds` the workers accept. */
export const STEP_MAX_DURATION_SECONDS = 604_800;

/**
 * Which inventory targets a run scans: those with any of `tags` (all targets when empty),
 * narrowed to `ranges` (no narrowing when empty). Nothing outside the inventory is ever scanned.
 */
export const TargetSelectorSchema = z.object({
  tags: TagsSchema,
  ranges: z.array(HostSelectorSchema).max(HOST_SELECTORS_MAX),
});

/** `targets`: the pipeline's addresses. `previous`: up hosts and open ports of the step before. */
export const PipelineStepInputSchema = z.enum(["targets", "previous"]);

export const PipelineSplitSchema = z.object({
  strategy: SplitStrategySchema,
  maxTasks: z.number().int().min(1).max(64).optional(),
  maxItemsPerTask: z.number().int().min(1).max(65_536).optional(),
});

export const PipelineStepSchema = z.object({
  workerId: z.uuid(),
  input: PipelineStepInputSchema,
  ports: PortSpecSchema,
  /** Packets per second for one job (all its tasks together). */
  rate: z.number().int().min(1).max(WORKER_MAX_RATE_LIMIT),
  batchSize: z
    .number()
    .int()
    .refine((size) => (PIPELINE_BATCH_SIZES as readonly number[]).includes(size), {
      message: "A power of two from 16 to 1024",
    }),
  maxDurationSeconds: z.number().int().min(60).max(STEP_MAX_DURATION_SECONDS),
  split: PipelineSplitSchema,
  params: WorkerParamsSchema,
});

const isTimeZone = (value: string) => {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
};

export const ScheduleUnitSchema = z.enum(["hour", "day", "week"]);

export const SCHEDULE_UNIT_MINUTES = { hour: 60, day: 1440, week: 10_080 } as const;

/**
 * Runs at `startsAt` (wall-clock time in `timezone`) and every `every` `unit`s after it, only
 * on `daysOfWeek` (ISO, 1 = Monday; empty = any day). A run may scan for `windowMinutes`; jobs
 * left then wait for the next run time.
 */
export const ScheduleSchema = z
  .object({
    every: z.number().int().min(1).max(365),
    unit: ScheduleUnitSchema,
    startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    daysOfWeek: z.array(z.number().int().min(1).max(7)).max(7),
    windowMinutes: z.number().int().min(5).max(10_080).nullable(),
    timezone: z.string().min(1).max(64).refine(isTimeZone, { message: "Unknown time zone" }),
  })
  .refine(
    ({ every, unit, windowMinutes }) =>
      windowMinutes === null || windowMinutes <= every * SCHEDULE_UNIT_MINUTES[unit],
    { message: "The time window must not be longer than the interval", path: ["windowMinutes"] },
  );

const NameSchema = NonBlankStringSchema.max(100);

const pipelineFields = {
  name: NameSchema,
  description: z.string().max(1000),
  /** Whether the schedule fires. Needs a `schedule`. */
  enabled: z.boolean(),
  targets: TargetSelectorSchema,
  steps: z.array(PipelineStepSchema).min(1).max(PIPELINE_MAX_STEPS),
  schedule: ScheduleSchema.nullable(),
};

const firstStepScansTargets = (steps: readonly { input: string }[] | undefined) =>
  steps === undefined || steps[0]?.input === "targets";

export const PipelineBodySchema = z
  .object(pipelineFields)
  .refine(({ steps }) => firstStepScansTargets(steps), {
    message: "The first step must scan the pipeline's targets",
    path: ["steps", 0, "input"],
  })
  .refine(({ enabled, schedule }) => !enabled || schedule !== null, {
    message: "Only a pipeline with a schedule can be enabled",
    path: ["enabled"],
  });

/** Any subset of the fields; `steps`, when given, replaces all steps. */
export const UpdatePipelineBodySchema = z
  .object(pipelineFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" })
  .refine(({ steps }) => firstStepScansTargets(steps), {
    message: "The first step must scan the pipeline's targets",
    path: ["steps", 0, "input"],
  });

export const PipelineStepDetailSchema = PipelineStepSchema.extend({
  position: z.number().int().positive(),
  worker: z.object({
    id: z.uuid(),
    name: z.string(),
    displayName: z.string(),
    enabled: z.boolean(),
  }),
});

export const PipelineRunSchema = z.object({
  id: z.uuid(),
  status: ScanStatusSchema,
  trigger: ScanTriggerSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  windowEndsAt: z.iso.datetime().nullable(),
  jobCount: z.number().int().nonnegative(),
});

export const PipelineSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  targets: TargetSelectorSchema,
  steps: z.array(PipelineStepDetailSchema),
  schedule: ScheduleSchema.nullable(),
  /** `null` without a schedule, or while disabled. */
  nextRunAt: z.iso.datetime().nullable(),
  lastRun: PipelineRunSchema.nullable(),
  /** A run still queued, running or paused: a new one waits until it ends. */
  activeRun: PipelineRunSchema.nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PipelineDetailSchema = PipelineSchema.extend({
  /** The newest runs first. */
  runs: z.array(PipelineRunSchema),
});

export const PipelineListResponseSchema = z.object({ items: z.array(PipelineSchema) });

export const RunPipelineResponseSchema = z.object({
  scan: QueuedScanSchema,
  /** Domains that could not be resolved, as in a target import. */
  warnings: z.array(ImportWarningSchema),
});

export const SCHEDULE_PREVIEW_MAX = 10;

export const SchedulePreviewBodySchema = z.object({
  schedule: ScheduleSchema,
  count: z.number().int().min(1).max(SCHEDULE_PREVIEW_MAX).optional(),
});

export const SchedulePreviewResponseSchema = z.object({ times: z.array(z.iso.datetime()) });

export type TargetSelector = z.infer<typeof TargetSelectorSchema>;
export type PipelineStepInput = z.infer<typeof PipelineStepInputSchema>;
export type PipelineSplit = z.infer<typeof PipelineSplitSchema>;
export type PipelineStep = z.infer<typeof PipelineStepSchema>;
export type ScheduleUnit = z.infer<typeof ScheduleUnitSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type PipelineBody = z.infer<typeof PipelineBodySchema>;
export type UpdatePipelineBody = z.infer<typeof UpdatePipelineBodySchema>;
export type PipelineStepDetail = z.infer<typeof PipelineStepDetailSchema>;
export type PipelineRun = z.infer<typeof PipelineRunSchema>;
export type Pipeline = z.infer<typeof PipelineSchema>;
export type PipelineDetail = z.infer<typeof PipelineDetailSchema>;
export type PipelineListResponse = z.infer<typeof PipelineListResponseSchema>;
export type RunPipelineResponse = z.infer<typeof RunPipelineResponseSchema>;
export type SchedulePreviewBody = z.infer<typeof SchedulePreviewBodySchema>;
export type SchedulePreviewResponse = z.infer<typeof SchedulePreviewResponseSchema>;
