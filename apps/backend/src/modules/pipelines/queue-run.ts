import type { QueuedScan, ScanJobHost, ScanTrigger } from "@subsurf/contracts/scans/scans.schema";
import { intersectRanges, ipv4ToInt, mergeRanges, rangeSize, type Ipv4Range } from "@subsurf/contracts/targets/ipv4";
import { parseTargetValue, type TargetKind } from "@subsurf/contracts/targets/target-input";
import type { ImportWarning } from "@subsurf/contracts/targets/targets.schema";

import { Prisma } from "~backend/generated/prisma/client";
import { chunks } from "~backend/lib/chunks";
import { encryptJson } from "~backend/lib/crypto";
import { hostTargets, jobParams, scanLimits, type ScanStepSnapshot } from "~backend/modules/pipelines/steps";
import { planScanJobs, type ScanJobPlan } from "~backend/modules/scans/batching";
import type { DnsResolution } from "~backend/modules/scans/dns";
import { toQueuedScan } from "~backend/modules/scans/scans.mapper";

const INSERT_BATCH = 2000;

export interface ScanTargetRow {
  id: string;
  kind: TargetKind;
  value: string;
}

/** What one step that scans targets covers. */
export interface StepTargets {
  targets: readonly ScanTargetRow[];
  /** Scan only these parts of the targets (the step's ranges); `undefined` = all of them. */
  within?: readonly Ipv4Range[];
}

export interface QueueRunInput {
  requestedById: string;
  pipelineId: string | null;
  trigger: ScanTrigger;
  steps: readonly ScanStepSnapshot[];
  /** By step index, for every step with input `targets`; a step missing here scans nothing. */
  stepTargets: ReadonlyMap<number, StepTargets>;
  /** Resolved beforehand (`resolveDomains`), outside the transaction, for every step's domains. */
  dns: DnsResolution;
  windowEndsAt: Date | null;
}

export interface QueueRunResult {
  scan: QueuedScan | null;
  warnings: ImportWarning[];
}

function targetRange(target: ScanTargetRow): Ipv4Range | null {
  const parsed = parseTargetValue(target.value);
  return parsed.ok ? parsed.range : null;
}

const singleAddress = (ip: string): Ipv4Range => ({ start: ipv4ToInt(ip), end: ipv4ToInt(ip) });

const isInside = (ip: string, within: readonly Ipv4Range[]) => {
  const address = ipv4ToInt(ip);
  return within.some((range) => address >= range.start && address <= range.end);
};

interface Scope {
  targets: ScanTargetRow[];
  ranges: Ipv4Range[];
  hosts: ScanJobHost[];
}

/**
 * What of a step's targets is scanned. The step's ranges narrow both addresses and resolved
 * domains, and drop targets left with nothing; without them every target counts, an
 * unresolvable domain included (as an import always did).
 */
function scanScope({ targets: stepTargets, within }: StepTargets, resolved: ReadonlyMap<string, string[]>): Scope {
  const hosts: ScanJobHost[] = [];
  const targets: ScanTargetRow[] = [];
  const ranges: Ipv4Range[] = [];

  for (const target of stepTargets) {
    if (target.kind === "domain") {
      const addresses = (resolved.get(target.value) ?? []).filter(
        (ip) => !within || isInside(ip, within),
      );
      if (addresses.length > 0 || !within) targets.push(target);
      hosts.push(...addresses.map((ip) => ({ ip, domain: target.value })));
      ranges.push(...addresses.map(singleAddress));
      continue;
    }
    const range = targetRange(target);
    const kept = range && within ? intersectRanges([range], within) : range ? [range] : [];
    if (kept.length > 0 || !within) targets.push(target);
    ranges.push(...kept);
  }
  return { targets, ranges: mergeRanges(ranges), hosts };
}

function jobRows(
  scanId: string,
  step: ScanStepSnapshot,
  plans: readonly ScanJobPlan[],
  firstSequence: number,
): Prisma.ScanJobCreateManyInput[] {
  return plans.map((plan, position) => ({
    scanId,
    sequence: firstSequence + position,
    stepIndex: step.index,
    worker: step.worker,
    kind: "discovery",
    subnet: plan.subnet,
    targets: plan.targets,
    hosts: plan.hosts,
    addressCount: plan.addressCount,
    params: jobParams(step, step.acceptsHosts ? [...plan.targets, ...hostTargets(plan.hosts)] : plan.targets),
  }));
}

/**
 * Queues one run: a Scan with the steps snapshotted, the targets its steps cover and the jobs of
 * every step that scans its own targets. Steps that take the previous step's hosts get jobs later, as
 * that step's jobs complete (`pipelineRuns.onResultStored`).
 */
export async function queueRun(
  tx: Prisma.TransactionClient,
  input: QueueRunInput,
): Promise<QueueRunResult> {
  const resolved = new Map(input.dns.resolved.map(({ domain, addresses }) => [domain, addresses]));
  const targetSteps = input.steps.filter((step) => step.input === "targets");
  const scopes = targetSteps.map((step) =>
    scanScope(input.stepTargets.get(step.index) ?? { targets: [] }, resolved),
  );
  const plans = targetSteps.map((step, index) => planScanJobs(scopes[index].ranges, scopes[index].hosts, step.batchSize));
  const jobCount = plans.reduce((sum, plan) => sum + plan.length, 0);
  // A step whose selection is empty right now just gets no jobs; only a run with none fails.
  if (jobCount === 0) {
    return { scan: null, warnings: [...input.dns.warnings, { code: "no_scannable_targets", value: "" }] };
  }

  const targets = [...new Map(scopes.flatMap((scope) => scope.targets).map((target) => [target.id, target])).values()];
  const addressCount = mergeRanges(scopes.flatMap((scope) => scope.ranges)).reduce(
    (sum, range) => sum + rangeSize(range),
    0,
  );
  const { ports, maxRate } = scanLimits(input.steps);
  const scan = await tx.scan.create({
    data: {
      pipelineId: input.pipelineId,
      trigger: input.trigger,
      steps: input.steps.map((step) => ({ ...step })),
      windowEndsAt: input.windowEndsAt,
      ports,
      maxRate,
      batchSize: targetSteps[0].batchSize,
      targetCount: targets.length,
      addressCount,
      jobCount,
      warnings: input.dns.warnings.length > 0 ? encryptJson(input.dns.warnings) : Prisma.DbNull,
      requestedById: input.requestedById,
    },
  });
  for (const batch of chunks(targets, INSERT_BATCH)) {
    await tx.scanTarget.createMany({
      data: batch.map((target) => ({ scanId: scan.id, targetId: target.id })),
    });
  }
  let sequence = 1;
  for (const [index, step] of targetSteps.entries()) {
    const rows = jobRows(scan.id, step, plans[index], sequence);
    sequence += rows.length;
    for (const batch of chunks(rows, INSERT_BATCH)) {
      await tx.scanJob.createMany({ data: batch });
    }
  }

  return { scan: toQueuedScan(scan), warnings: input.dns.warnings };
}
