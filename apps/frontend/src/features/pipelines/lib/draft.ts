import { parseHostSelectors } from "@subsurf/contracts/hosts/host-selectors";
import type {
  Pipeline,
  PipelineBody,
  PipelineStep,
  Schedule,
  TargetSelector,
} from "@subsurf/contracts/pipelines/pipelines.schema";
import { defaultStepParams } from "@subsurf/contracts/workers/worker-catalog";
import type { Worker } from "@subsurf/contracts/workers/worker-registry.schema";

/** A step's target selection in the editor. Ranges stay text until saved. */
export interface TargetDraft {
  tags: string[];
  targetIds: string[];
  rangesText: string;
}

/**
 * A step in the editor: the API's step plus a stable key for React and drag and drop. Every step
 * keeps a target draft, so switching its input away from targets and back loses nothing.
 */
export type StepDraft = Omit<PipelineStep, "targets"> & { key: string; target: TargetDraft };

/** The editor's form state. Numbers may be NaN while typed. */
export interface PipelineDraft {
  name: string;
  description: string;
  enabled: boolean;
  steps: StepDraft[];
  schedule: Schedule | null;
}

const emptyTarget = (): TargetDraft => ({ tags: [], targetIds: [], rangesText: "" });

export function targetSelector(target: TargetDraft): TargetSelector {
  return {
    tags: target.tags,
    targetIds: target.targetIds,
    ranges: parseHostSelectors(target.rangesText).selectors,
  };
}

export const PORT_PRESETS = {
  common:
    "21,22,23,25,53,80,110,111,135,139,143,443,445,993,995,1433,1521,2049,3306,3389,5432,5900,6379,8000,8080,8443,9200,27017",
  web: "80,443,3000,5000,8000-8100,8443,8888,9000,9443",
  all: "1-65535",
} as const;

export type PortPreset = keyof typeof PORT_PRESETS;
export const PORT_PRESET_KEYS: readonly PortPreset[] = ["common", "web", "all"];

const DEFAULT_RATE = 1000;
const DEFAULT_MAX_DURATION_SECONDS = 3600;

const newKey = () => crypto.randomUUID();

/**
 * A new step of `worker`, appended after `previous`: it takes the previous step's hits when it
 * can, and starts from the previous step's target selection.
 */
export function newStep(worker: Worker, previous: StepDraft | undefined): StepDraft {
  const takesHosts = previous !== undefined && worker.inputs.includes("hosts");
  return {
    key: newKey(),
    workerId: worker.id,
    input: takesHosts || !worker.inputs.includes("targets") ? "previous" : "targets",
    target: previous ? { ...previous.target } : emptyTarget(),
    ports: previous?.ports ?? PORT_PRESETS.common,
    rate: Math.min(DEFAULT_RATE, worker.maxRate),
    batchSize: 256,
    maxDurationSeconds: DEFAULT_MAX_DURATION_SECONDS,
    split: { strategy: worker.splitStrategies.includes("none") ? "none" : (worker.splitStrategies[0] ?? "none") },
    params: defaultStepParams(worker.paramFields, worker.defaults),
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

function localDateTime(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Nightly, from 01:00 tomorrow in the browser's time zone, with a 4-hour window. */
export function defaultSchedule(): Schedule {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(1, 0, 0, 0);
  return {
    every: 1,
    unit: "day",
    startsAt: localDateTime(tomorrow),
    daysOfWeek: [],
    windowMinutes: 240,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** A new pipeline: masscan, then nmap on its hits, when both are enabled. */
export function emptyDraft(workers: readonly Worker[]): PipelineDraft {
  const steps: StepDraft[] = [];
  for (const name of ["masscan", "nmap"]) {
    const worker = workers.find((candidate) => candidate.name === name && candidate.enabled);
    if (worker) steps.push(newStep(worker, steps.at(-1)));
  }
  return { name: "", description: "", enabled: false, steps, schedule: null };
}

export function draftFromPipeline(pipeline: Pipeline): PipelineDraft {
  return {
    name: pipeline.name,
    description: pipeline.description,
    enabled: pipeline.enabled,
    steps: pipeline.steps.map(({ position: _position, worker: _worker, targets, ...step }) => ({
      ...step,
      key: newKey(),
      target: targets
        ? { tags: targets.tags, targetIds: targets.targetIds, rangesText: targets.ranges.join("\n") }
        : emptyTarget(),
    })),
    schedule: pipeline.schedule,
  };
}

export function draftToBody(draft: PipelineDraft): PipelineBody {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    enabled: draft.schedule !== null && draft.enabled,
    steps: draft.steps.map(({ key: _key, target, ...step }) => ({
      ...step,
      targets: step.input === "targets" ? targetSelector(target) : null,
    })),
    schedule: draft.schedule,
  };
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}
