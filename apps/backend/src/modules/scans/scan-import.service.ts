import { createHash, randomUUID } from "node:crypto";

import { SCAN_IMPORT_LIMITS, type ScanImport, type ScanImportIssue } from "@subsurf/contracts/scans/scan-import";
import type {
  ImportedEdits,
  ImportScanQuery,
  ImportScanResponse,
} from "@subsurf/contracts/scans/scan-import.schema";
import { WorkerResultSchema } from "@subsurf/contracts/workers/worker-result.schema";

import { env } from "~backend/config/env";
import type { Prisma } from "~backend/generated/prisma/client";
import type { AuthContext } from "~backend/lib/auth-context";
import { chunks } from "~backend/lib/chunks";
import { HttpError } from "~backend/lib/http-error";
import { isUniqueViolation, prisma } from "~backend/lib/prisma";
import { hostsService } from "~backend/modules/hosts/hosts.service";
import { resultsService } from "~backend/modules/results/results.service";
import { planScanImport, type ScanImportPlan } from "~backend/modules/scans/scan-import.plan";

const INSERT_BATCH = 2000;
// One transaction holds the scan, its jobs and every result, so a failed import leaves nothing.
const TRANSACTION_TIMEOUT_MS = 5 * 60_000;
// Arbitrary, fixed: one import at a time keeps two of them from interleaving on the same hosts.
const IMPORT_LOCK = 7_366_737_101;

const importKeyOf = (plan: ScanImportPlan) =>
  createHash("sha256").update(JSON.stringify(plan.identity)).digest("hex");

async function alreadyImported(importKey: string): Promise<HttpError | null> {
  const existing = await prisma.scan.findUnique({ where: { importKey }, select: { id: true } });
  return existing
    ? new HttpError(409, "This file was imported before", {
        code: "SCAN_ALREADY_IMPORTED",
        details: { scanId: existing.id },
      })
    : null;
}

/** `createdAt` orders scans (base scan, lifecycle, dashboard): two scans never share one. */
async function freeCreatedAt(tx: Prisma.TransactionClient, wanted: Date): Promise<Date> {
  let createdAt = wanted;
  while (await tx.scan.findFirst({ where: { createdAt }, select: { id: true } })) {
    createdAt = new Date(createdAt.getTime() + 1);
  }
  return createdAt;
}

async function writeImport(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  read: ScanImport,
  plan: ScanImportPlan,
  query: ImportScanQuery,
  importKey: string,
): Promise<{ scanId: string; placedAt: Date; edits: ImportedEdits | null }> {
  const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(${IMPORT_LOCK}) AS locked`;
  if (!lock?.locked) {
    throw HttpError.conflict("Another scan import is running", "SCAN_IMPORT_RUNNING");
  }

  const now = new Date();
  // A file from the future would outrank every real scan until that day.
  const recorded = plan.scan.createdAt && plan.scan.createdAt < now ? plan.scan.createdAt : now;
  const createdAt = await freeCreatedAt(tx, recorded);
  const scan = await tx.scan.create({
    data: {
      name: query.name?.trim() ?? "",
      origin: "imported",
      importKey,
      status: plan.scan.status,
      ports: plan.scan.ports ?? env.SCAN_DEFAULT_PORTS,
      // 0: the file does not record a rate.
      maxRate: plan.scan.maxRate ?? 0,
      batchSize: env.SCAN_BATCH_SIZE,
      targetCount: 0,
      addressCount: plan.scan.addressCount,
      jobCount: plan.jobs.length,
      requestedById: auth.user.id,
      createdAt,
      startedAt: plan.scan.startedAt,
      finishedAt: plan.scan.finishedAt,
    },
    select: { id: true },
  });

  const leases = plan.jobs.map(() => randomUUID());
  const jobIds = new Map<number, string>();
  const rows = plan.jobs.map((job, index) => ({
    scanId: scan.id,
    sequence: index + 1,
    // Finished from the start: a worker lease must never pick an imported job up.
    status: "completed" as const,
    subnet: job.subnet,
    targets: job.targets,
    addressCount: job.addressCount,
    attempts: 1,
    leaseId: leases[index],
    leasedBy: "import",
    startedAt: new Date(job.result.scan.startedAt),
    finishedAt: new Date(job.result.scan.finishedAt),
    durationMs: job.result.scan.durationMs,
  }));
  for (const batch of chunks(rows, INSERT_BATCH)) {
    const created = await tx.scanJob.createManyAndReturn({
      data: batch,
      select: { id: true, sequence: true },
    });
    for (const job of created) jobIds.set(job.sequence, job.id);
  }

  for (const [index, job] of plan.jobs.entries()) {
    const jobId = jobIds.get(index + 1);
    const leaseId = leases[index];
    if (!jobId || !leaseId) throw new Error(`Import job ${index + 1} was not created`);
    await resultsService.ingestWithin(
      tx,
      WorkerResultSchema.parse({
        scan: { jobId, leaseId, scanId: scan.id, ...job.result.scan },
        hosts: job.result.hosts,
      }),
    );
  }
  // `receivedAt` defaulted to when this transaction began; vuln-sync only looks back two minutes.
  await tx.$executeRaw`
    UPDATE "ScanJobResult" SET "receivedAt" = clock_timestamp() WHERE "scanId" = ${scan.id}::uuid`;

  const edits =
    query.edits === "fill" && read.inputFormat !== "worker-results"
      ? await hostsService.mergeEdits(tx, read.edits)
      : null;
  return { scanId: scan.id, placedAt: createdAt, edits };
}

/**
 * Turns a results file into a scan: its rows, one finished job per batch and the worker results
 * ingested the way a worker's own are, so encryption, fingerprints and the Host/Service assets
 * follow the same rules. The scan takes its place among the others by when the file says it ran.
 */
export const scanImportService = {
  async importScan(
    auth: AuthContext,
    read: ScanImport,
    query: ImportScanQuery,
    warnings: readonly ScanImportIssue[] = [],
  ): Promise<ImportScanResponse> {
    if (query.edits === "fill" && !auth.permissions.includes("hosts:update")) {
      throw HttpError.forbidden("Missing permission: hosts:update");
    }

    const plan = planScanImport(read, { batchSize: env.SCAN_BATCH_SIZE, now: new Date() });
    const importKey = importKeyOf(plan);
    const duplicate = await alreadyImported(importKey);
    if (duplicate) throw duplicate;

    let written;
    try {
      written = await prisma.$transaction(
        (tx) => writeImport(tx, auth, read, plan, query, importKey),
        { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
      );
    } catch (error) {
      // Two uploads of one file raced past the check above.
      const raced = isUniqueViolation(error) ? await alreadyImported(importKey) : null;
      throw raced ?? error;
    }

    return {
      scanId: written.scanId,
      placedAt: written.placedAt.toISOString(),
      inputFormat: read.inputFormat,
      jobs: plan.jobs.length,
      hosts: plan.hosts,
      openPorts: plan.openPorts,
      edits: written.edits,
      warnings: warnings.slice(0, SCAN_IMPORT_LIMITS.maxReportedIssues),
      warningCount: warnings.length,
    };
  },
};
