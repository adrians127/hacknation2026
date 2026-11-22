import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseCidr, cidrToRange, rangeSize } from "@subsurf/contracts/targets/ipv4";
import { WorkerResultSchema } from "@subsurf/contracts/workers/worker-result.schema";

import { DEMO_NETWORK, DEMO_SCAN_PORTS, demoDomainHosts } from "~backend/demo/network";
import { buildDemoRun, DEMO_RUNS, type DemoJobResult, type DemoRun } from "~backend/demo/runs";
import type { PrismaClient } from "~backend/generated/prisma/client";
import { resultsService } from "~backend/modules/results/results.service";
import { planScanJobs } from "~backend/modules/scans/batching";
import { targetRow } from "~backend/modules/targets/target-row";

const BATCH_SIZE = 256;
const MAX_RATE = 100;

export interface SeedDemoOptions {
  /** Owner of the demo targets and scans (an admin). */
  requestedById: string;
  /** Also write every worker result as a JSON file under this directory. */
  jsonDir?: string;
  log?: (message: string) => void;
  /** Runs after each scan run is ingested (e.g. re-matching vulnerabilities). */
  afterRun?: (run: DemoRun) => Promise<void>;
}

export interface SeedDemoSummary {
  results: { ingested: number; duplicate: number };
  hosts: number;
  services: number;
}

async function ensureTargets(prisma: PrismaClient, requestedById: string) {
  const domains = demoDomainHosts();
  const owner = { createdById: requestedById };
  await prisma.target.createMany({
    data: [
      targetRow(
        {
          kind: "cidr",
          value: DEMO_NETWORK,
          note: "Demo network (db:seed:hosts)",
          range: cidrToRange(parseCidr(DEMO_NETWORK)),
        },
        owner,
      ),
      ...domains.map(({ domain }) =>
        targetRow(
          { kind: "domain", value: domain, note: "Demo domain (db:seed:hosts)", range: null },
          owner,
        ),
      ),
    ],
    skipDuplicates: true,
  });
  return prisma.target.findMany({
    where: { value: { in: [DEMO_NETWORK, ...domains.map(({ domain }) => domain)] } },
    select: { id: true },
  });
}

/** The scan and its jobs, planned like an import would (`planScanJobs`); kept if it exists. */
async function ensureScan(
  prisma: PrismaClient,
  run: DemoRun,
  requestedById: string,
  targetIds: string[],
) {
  const existing = await prisma.scan.findUnique({ where: { id: run.scanId } });
  if (!existing) {
    const range = cidrToRange(parseCidr(DEMO_NETWORK));
    const jobs = planScanJobs([range], demoDomainHosts(), BATCH_SIZE);
    await prisma.$transaction(async (tx) => {
      await tx.scan.create({
        data: {
          id: run.scanId,
          status: "running",
          ports: DEMO_SCAN_PORTS,
          maxRate: MAX_RATE,
          batchSize: BATCH_SIZE,
          targetCount: targetIds.length,
          addressCount: rangeSize(range),
          jobCount: jobs.length,
          requestedById,
          createdAt: new Date(run.startedAt),
          startedAt: new Date(run.startedAt),
        },
      });
      await tx.scanTarget.createMany({
        data: targetIds.map((targetId) => ({ scanId: run.scanId, targetId })),
      });
      await tx.scanJob.createMany({
        data: jobs.map((job, index) => ({
          scanId: run.scanId,
          sequence: index + 1,
          subnet: job.subnet,
          targets: job.targets,
          hosts: job.hosts,
          addressCount: job.addressCount,
        })),
      });
    });
  }
  return prisma.scanJob.findMany({
    where: { scanId: run.scanId },
    orderBy: { sequence: "asc" },
    select: { id: true, sequence: true, subnet: true, targets: true },
  });
}

/** What the lease handlers would have recorded: who ran each job, when, and how it ended. */
async function finishRun(prisma: PrismaClient, run: DemoRun, results: DemoJobResult[]) {
  for (const { job, workerId, hitDeadline, result } of results) {
    await prisma.scanJob.update({
      where: { id: job.id },
      data: {
        status: hitDeadline ? "stopped" : "completed",
        attempts: 1,
        leaseId: result.scan.leaseId,
        leasedBy: workerId,
        startedAt: new Date(result.scan.startedAt),
        heartbeatAt: new Date(result.scan.finishedAt),
        finishedAt: new Date(result.scan.finishedAt),
        durationMs: result.scan.durationMs,
      },
    });
  }
  const finishedAt = Math.max(...results.map(({ result }) => Date.parse(result.scan.finishedAt)));
  await prisma.scan.update({
    where: { id: run.scanId },
    // The second run is cut by its window (PDF: stop, resume in the next window).
    data: {
      status: results.some(({ hitDeadline }) => hitDeadline) ? "stopped" : "completed",
      finishedAt: new Date(finishedAt),
    },
  });
}

async function writeJson(dir: string, run: DemoRun, results: DemoJobResult[]) {
  const runDir = join(dir, `run-${run.number}`);
  await mkdir(runDir, { recursive: true });
  for (const { job, result } of results) {
    const name = `job-${String(job.sequence).padStart(3, "0")}.json`;
    await writeFile(join(runDir, name), `${JSON.stringify(result, null, 2)}\n`);
  }
}

/**
 * Seeds four demo scans of a /18 through the real ingest path. Idempotent: existing scans are
 * kept, and results already ingested (same lease) are skipped.
 */
export async function seedDemoHosts(
  prisma: PrismaClient,
  options: SeedDemoOptions,
): Promise<SeedDemoSummary> {
  const log = options.log ?? (() => undefined);
  const targets = await ensureTargets(prisma, options.requestedById);
  const summary: SeedDemoSummary = { results: { ingested: 0, duplicate: 0 }, hosts: 0, services: 0 };

  for (const run of DEMO_RUNS) {
    const targetIds = targets.map((target) => target.id);
    const jobs = await ensureScan(prisma, run, options.requestedById, targetIds);
    const results = buildDemoRun(run, jobs);
    for (const { result } of results) {
      const outcome = await resultsService.ingest(WorkerResultSchema.parse(result));
      summary.results[outcome.status] += 1;
    }
    await finishRun(prisma, run, results);
    if (options.jsonDir) await writeJson(options.jsonDir, run, results);
    const up = results.reduce((sum, { result }) => sum + result.scan.counts.up, 0);
    log(`Run ${run.number} (${run.startedAt}): ${results.length} jobs, ${up} hosts up`);
    await options.afterRun?.(run);
  }

  summary.hosts = await prisma.host.count();
  summary.services = await prisma.service.count();
  return summary;
}
