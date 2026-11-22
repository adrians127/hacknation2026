import type { QueuedScan, ScanJobHost, ScanTrigger } from "@subsurf/contracts/scans/scans.schema";
import { ipv4ToInt, mergeRanges, type Ipv4Range } from "@subsurf/contracts/targets/ipv4";
import { parseTargetValue, type TargetKind } from "@subsurf/contracts/targets/target-input";
import type { ImportWarning } from "@subsurf/contracts/targets/targets.schema";

import { Prisma } from "~backend/generated/prisma/client";
import { chunks } from "~backend/lib/chunks";
import { encryptJson } from "~backend/lib/crypto";
import { hostTargets, jobParams, scanLimits, type ScanStepSnapshot } from "~backend/modules/pipelines/steps";
import { intersectRanges } from "~backend/modules/pipelines/target-selection";
import { planScanJobs, type ScanJobPlan } from "~backend/modules/scans/batching";
import type { DnsResolution } from "~backend/modules/scans/dns";
import { toQueuedScan } from "~backend/modules/scans/scans.mapper";

const INSERT_BATCH = 2000;

export interface ScanTargetRow {
  id: string;
  kind: TargetKind;
  value: string;
}

export interface QueueRunInput {
  requestedById: string;
  pipelineId: string | null;
  trigger: ScanTrigger;
  steps: readonly ScanStepSnapshot[];
  targets: readonly ScanTargetRow[];
  /** Resolved beforehand (`resolveDomains`), outside the transaction. */
  dns: DnsResolution;
  /** Scan only these parts of the targets (a pipeline's ranges); `undefined` = all of them. */
  within?: readonly Ipv4Range[];
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
 * What of the targets is scanned. The selector's ranges narrow both addresses and resolved
 * domains, and drop targets left with nothing; without them every target counts, an
 * unresolvable domain included (as an import always did).
 */
function scanScope(input: QueueRunInput): Scope {
  const { within } = input;
  const resolved = new Map(input.dns.resolved.map(({ domain, addresses }) => [domain, addresses]));
  const hosts: ScanJobHost[] = [];
  const targets: ScanTargetRow[] = [];
  const ranges: Ipv4Range[] = [];

  for (const target of input.targets) {
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
 * Queues one run: a Scan with the steps snapshotted, the targets it covers and the jobs of every
 * step that scans the targets. Steps that take the previous step's hosts get jobs later, as
 * that step's jobs complete (`pipelineRuns.onResultStored`).
 */
export async function queueRun(
  tx: Prisma.TransactionClient,
  input: QueueRunInput,
): Promise<QueueRunResult> {
  const { targets, ranges, hosts } = scanScope(input);
  const targetSteps = input.steps.filter((step) => step.input === "targets");
  const plans = targetSteps.map((step) => planScanJobs(ranges, hosts, step.batchSize));
  const [firstPlan = []] = plans;
  if (firstPlan.length === 0) {
    return { scan: null, warnings: [...input.dns.warnings, { code: "no_scannable_targets", value: "" }] };
  }

  const { ports, maxRate } = scanLimits(input.steps);
  const jobCount = plans.reduce((sum, plan) => sum + plan.length, 0);
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
      addressCount: firstPlan.reduce((sum, job) => sum + job.addressCount, 0),
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
