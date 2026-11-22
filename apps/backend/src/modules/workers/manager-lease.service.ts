import type { ManagerJob, ManagerLeaseRequest } from "@subsurf/contracts/workers/workers.schema";

import { env } from "~backend/config/env";
import { prisma } from "~backend/lib/prisma";
import { leaseJob } from "~backend/modules/pipelines/manager-job";
import { MIN_WINDOW_LEFT_MS } from "~backend/modules/pipelines/pipeline-runs.service";

/**
 * Leases queued jobs to one manager: only for workers it offers and an admin enabled, only of
 * scans that may run now (queued or running, with time left in their window), oldest scan
 * first and earlier steps first. `SKIP LOCKED` keeps two managers from leasing one job.
 */
export async function leaseJobs(request: ManagerLeaseRequest, now = new Date()): Promise<ManagerJob[]> {
  const enabled = await prisma.worker.findMany({
    where: { enabled: true, name: { in: request.workers } },
    select: { name: true },
  });
  if (enabled.length === 0) return [];
  // A handful of active scans: filtering them here keeps dates out of the raw query.
  const scans = await prisma.scan.findMany({
    where: {
      status: { in: ["queued", "running"] },
      OR: [{ windowEndsAt: null }, { windowEndsAt: { gt: new Date(now.getTime() + MIN_WINDOW_LEFT_MS) } }],
    },
    select: { id: true },
  });
  if (scans.length === 0) return [];

  const limit = request.max_parallel * env.WORKER_LEASE_JOBS_PER_SLOT;
  const workers = enabled.map((worker) => worker.name);
  const scanIds = scans.map((scan) => scan.id);
  return prisma.$transaction(async (tx) => {
    const picked = await tx.$queryRaw<{ id: string }[]>`
      SELECT j.id FROM "ScanJob" j
      JOIN "Scan" s ON s.id = j."scanId"
      WHERE j.status = 'queued'
        AND j."scanId" = ANY(${scanIds}::uuid[])
        AND j.worker = ANY(${workers}::text[])
      ORDER BY s."createdAt", j."stepIndex", j.sequence
      LIMIT ${limit}
      FOR UPDATE OF j SKIP LOCKED`;
    if (picked.length === 0) return [];

    const rows = await tx.scanJob.findMany({
      where: { id: { in: picked.map((row) => row.id) } },
      include: { scan: true },
    });
    const order = new Map(picked.map((row, index) => [row.id, index]));
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    const jobs: ManagerJob[] = [];
    for (const row of rows) {
      const lease = leaseJob(row, row.scan, now);
      await tx.scanJob.update({
        where: { id: row.id },
        data: {
          status: "leased",
          leaseId: lease.leaseId,
          leasedBy: request.manager_id,
          leaseExpiresAt: lease.expiresAt,
          heartbeatAt: now,
          startedAt: now,
          finishedAt: null,
          durationMs: null,
          attempts: { increment: 1 },
        },
      });
      jobs.push(lease.job);
    }
    await tx.scan.updateMany({
      where: { id: { in: [...new Set(rows.map((row) => row.scanId))] }, status: "queued" },
      data: { status: "running", startedAt: now },
    });
    return jobs;
  });
}
