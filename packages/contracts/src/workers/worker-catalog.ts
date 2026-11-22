import { z } from "zod";

// The blocks a pipeline is built from. A worker's `name` is the one worker-manager runs it under
// (`WORKER_MANAGER_WORKERS`, `jobs[].worker`). Every worker is registered by a manager's lease
// request, with the capabilities its manifest announces (`WorkerSpecSchema` in workers.schema.ts).

export const WORKER_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const WorkerNameSchema = z.string().regex(WORKER_NAME_PATTERN);

/** `targets`: address ranges of a step's targets. `hosts`: IPs with open ports from an earlier step. */
export const WorkerInputSchema = z.enum(["targets", "hosts"]);

/** worker-manager's split strategies (its README, "Split strategies"). */
export const SplitStrategySchema = z.enum(["none", "shard", "ranges", "chunk"]);

/** Highest packets per second any worker or step may be given (worker-manager's default budget). */
export const WORKER_MAX_RATE_LIMIT = 100_000;

/** Job fields the backend fills in itself; a worker field may not use these keys. */
export const RESERVED_PARAM_KEYS: readonly string[] = [
  "job_id",
  "scan_id",
  "lease_id",
  "task_id",
  "task_index",
  "task_count",
  "targets",
  "exclude",
  "ports",
  "rate",
  "max_duration_seconds",
  "deadline",
  "shard",
  "seed",
  "resume_index",
];

const ParamKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .refine((key) => !RESERVED_PARAM_KEYS.includes(key), { message: "This key is set by the backend" });

const fieldBase = {
  key: ParamKeySchema,
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
};

/** One worker-specific job field, rendered as a form control in the pipeline editor. */
export const WorkerParamFieldSchema = z.discriminatedUnion("type", [
  z.object({
    ...fieldBase,
    type: z.literal("integer"),
    min: z.number().int(),
    max: z.number().int(),
    unit: z.enum(["seconds", "milliseconds"]).optional(),
    default: z.number().int().optional(),
  }),
  z.object({ ...fieldBase, type: z.literal("boolean"), default: z.boolean().optional() }),
  z.object({
    ...fieldBase,
    type: z.literal("enum"),
    options: z.array(z.string().min(1).max(64)).min(1).max(32),
    default: z.string().optional(),
  }),
  z.object({
    ...fieldBase,
    type: z.literal("paths"),
    maxItems: z.number().int().min(1).max(128),
    default: z.array(z.string()).optional(),
  }),
]);

export const WorkerParamFieldsSchema = z
  .array(WorkerParamFieldSchema)
  .max(32)
  .refine((fields) => new Set(fields.map((field) => field.key)).size === fields.length, {
    message: "Field keys must be unique",
  });

export const WorkerParamValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string().max(2048),
  z.array(z.string().max(2048)).max(128),
]);

/** Worker-specific job fields by key, e.g. `{ "wait_seconds": 3 }`. */
export const WorkerParamsSchema = z.record(z.string().max(64), WorkerParamValueSchema);

export type WorkerInput = z.infer<typeof WorkerInputSchema>;
export type SplitStrategy = z.infer<typeof SplitStrategySchema>;
export type WorkerParamField = z.infer<typeof WorkerParamFieldSchema>;
export type WorkerParamValue = z.infer<typeof WorkerParamValueSchema>;
export type WorkerParams = z.infer<typeof WorkerParamsSchema>;

// Not "too_many": i18next would read a `_many` suffix as a plural form.
export type StepParamIssueCode = "unknown" | "type" | "range" | "option" | "too_long" | "path";

export interface StepParamIssue {
  key: string;
  code: StepParamIssueCode;
}

const isSafePath = (path: string) =>
  path.startsWith("/") && !path.startsWith("//") && path.length <= 2048;

/** Checks worker-specific params against the worker's fields. Unknown keys are rejected. */
export function validateStepParams(
  fields: readonly WorkerParamField[],
  params: Readonly<Record<string, unknown>>,
): StepParamIssue[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const issues: StepParamIssue[] = [];
  for (const [key, value] of Object.entries(params)) {
    const field = byKey.get(key);
    if (!field) {
      issues.push({ key, code: "unknown" });
      continue;
    }
    switch (field.type) {
      case "integer":
        if (typeof value !== "number" || !Number.isInteger(value)) issues.push({ key, code: "type" });
        else if (value < field.min || value > field.max) issues.push({ key, code: "range" });
        break;
      case "boolean":
        if (typeof value !== "boolean") issues.push({ key, code: "type" });
        break;
      case "enum":
        if (typeof value !== "string") issues.push({ key, code: "type" });
        else if (!field.options.includes(value)) issues.push({ key, code: "option" });
        break;
      case "paths":
        if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
          issues.push({ key, code: "type" });
        } else if (value.length > field.maxItems) {
          issues.push({ key, code: "too_long" });
        } else if (!value.every(isSafePath)) {
          issues.push({ key, code: "path" });
        }
        break;
    }
  }
  return issues;
}

/** The fields' own defaults, from the worker's manifest. */
export function defaultStepParams(fields: readonly WorkerParamField[]): WorkerParams {
  const params: WorkerParams = {};
  for (const field of fields) {
    if (field.default !== undefined) params[field.key] = field.default;
  }
  return params;
}
