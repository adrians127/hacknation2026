import { z } from "zod";

import {
  PipelineSplitSchema,
  PipelineStepInputSchema,
  type PipelineSplit,
} from "@subsurf/contracts/pipelines/pipelines.schema";
import { unionPortSpecs } from "@subsurf/contracts/scans/port-spec";
import type { ScanJobHost } from "@subsurf/contracts/scans/scans.schema";
import { defaultStepParams, WorkerParamsSchema } from "@subsurf/contracts/workers/worker-catalog";

import { env } from "~backend/config/env";
import type { Prisma } from "~backend/generated/prisma/client";
import { workerFields, workerInputs } from "~backend/modules/workers/workers.mapper";

/** A pipeline step as a run snapshotted it (`Scan.steps`): editing the pipeline later does not change the run. */
export const ScanStepSnapshotSchema = z.object({
  index: z.number().int().positive(),
  workerId: z.uuid().nullable(),
  worker: z.string(),
  /** The worker takes `{ip, ports, domains}` host objects in `targets` (nmap). */
  acceptsHosts: z.boolean(),
  input: PipelineStepInputSchema,
  ports: z.string(),
  rate: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  maxDurationSeconds: z.number().int().positive(),
  split: PipelineSplitSchema,
  params: WorkerParamsSchema,
});

export type ScanStepSnapshot = z.infer<typeof ScanStepSnapshotSchema>;

const StepsSchema = z.array(ScanStepSnapshotSchema);

/** `[]` for scans queued before pipelines existed. */
export function readSteps(stored: unknown): ScanStepSnapshot[] {
  const parsed = StepsSchema.safeParse(stored);
  return parsed.success ? parsed.data : [];
}

const IMPORT_STEP_MAX_DURATION_SECONDS = 3600;

/** The workers of the default chain, as worker-manager names them. */
const DISCOVERY_WORKER = "masscan";
const SERVICE_WORKER = "nmap";

export interface DefaultSteps {
  steps: (ScanStepSnapshot & { workerId: string })[];
  /** Workers of the chain no manager has registered with the input they need; their steps are left out. */
  missing: string[];
}

/**
 * What a target import with "Start a scan right away" runs: masscan over the targets with the
 * env defaults, then nmap on the hosts and ports it found. Both come from the worker registry;
 * without masscan nothing runs, without nmap masscan runs alone.
 */
export async function defaultSteps(db: Prisma.TransactionClient): Promise<DefaultSteps> {
  const workers = await db.worker.findMany({ where: { name: { in: [DISCOVERY_WORKER, SERVICE_WORKER] } } });
  const masscan = workers.find((worker) => worker.name === DISCOVERY_WORKER && workerInputs(worker).includes("targets"));
  const nmap = workers.find((worker) => worker.name === SERVICE_WORKER && workerInputs(worker).includes("hosts"));
  if (!masscan) return { steps: [], missing: [DISCOVERY_WORKER] };

  const common = {
    ports: env.SCAN_DEFAULT_PORTS,
    batchSize: env.SCAN_BATCH_SIZE,
    maxDurationSeconds: IMPORT_STEP_MAX_DURATION_SECONDS,
    split: { strategy: "none" } satisfies PipelineSplit,
  };
  const steps: DefaultSteps["steps"] = [
    {
      ...common,
      index: 1,
      workerId: masscan.id,
      worker: masscan.name,
      acceptsHosts: workerInputs(masscan).includes("hosts"),
      input: "targets",
      rate: Math.min(env.SCAN_DEFAULT_MAX_RATE, masscan.maxRate),
      params: defaultStepParams(workerFields(masscan)),
    },
  ];
  if (!nmap) return { steps, missing: [SERVICE_WORKER] };
  steps.push({
    ...common,
    index: 2,
    workerId: nmap.id,
    worker: nmap.name,
    acceptsHosts: true,
    input: "previous",
    rate: Math.min(env.SCAN_DEFAULT_MAX_RATE, nmap.maxRate),
    params: defaultStepParams(workerFields(nmap)),
  });
  return { steps, missing: [] };
}

/** `Scan.ports` and `Scan.maxRate`: results are checked against the union of every step's ports. */
export function scanLimits(steps: readonly ScanStepSnapshot[]): { ports: string; maxRate: number } {
  return {
    ports: unionPortSpecs(steps.map((step) => step.ports)),
    maxRate: Math.max(...steps.map((step) => step.rate)),
  };
}

// A type, not an interface: it must fit Prisma's JSON index signature.
export type HostTarget = {
  ip: string;
  ports?: number[];
  domains: string[];
};

/** Resolved domains as host objects, one per IP, for workers that take them. */
export function hostTargets(hosts: readonly ScanJobHost[]): HostTarget[] {
  const domains = new Map<string, Set<string>>();
  for (const { ip, domain } of hosts) {
    const set = domains.get(ip) ?? new Set<string>();
    set.add(domain);
    domains.set(ip, set);
  }
  return [...domains].map(([ip, names]) => ({ ip, domains: [...names].toSorted() }));
}

/** The worker's job without the envelope (`ScanJob.params`); `max_duration_seconds` is set at lease time. */
export function jobParams(
  step: ScanStepSnapshot,
  targets: readonly (string | HostTarget)[],
): Prisma.InputJsonObject {
  return { ...step.params, targets, ports: step.ports, rate: step.rate };
}
