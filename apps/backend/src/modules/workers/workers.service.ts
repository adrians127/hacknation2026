import type {
  UpdateWorkerBody,
  Worker,
  WorkerListResponse,
} from "@subsurf/contracts/workers/worker-registry.schema";
import type { ManagerLeaseRequest, WorkerSpec } from "@subsurf/contracts/workers/workers.schema";

import type { Worker as WorkerRow } from "~backend/generated/prisma/client";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { sameJson } from "~backend/lib/same-json";
import { isManagerOnline, toWorker, toWorkerManager } from "~backend/modules/workers/workers.mapper";

async function findWorker(id: string) {
  const worker = await prisma.worker.findUnique({ where: { id } });
  if (!worker) throw HttpError.notFound("Worker not found");
  return worker;
}

async function onlineManagersByWorker(now: Date): Promise<Map<string, number>> {
  const managers = await prisma.workerManager.findMany();
  const counts = new Map<string, number>();
  for (const manager of managers.filter((row) => isManagerOnline(row, now))) {
    for (const name of manager.workers) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

/** The part of a worker its manager owns. */
function capabilities(spec: WorkerSpec) {
  return {
    inputs: [...spec.inputs],
    splitStrategies: [...spec.split_strategies],
    paramFields: (spec.param_fields ?? []).map((field) => ({ ...field })),
  };
}

const sameCapabilities = (row: WorkerRow, wanted: ReturnType<typeof capabilities>) =>
  sameJson(row.inputs, wanted.inputs) &&
  sameJson(row.splitStrategies, wanted.splitStrategies) &&
  sameJson(row.paramFields, wanted.paramFields);

export const workersService = {
  async list(now = new Date()): Promise<WorkerListResponse> {
    const [workers, managers] = await Promise.all([
      prisma.worker.findMany({ orderBy: [{ displayName: "asc" }, { name: "asc" }] }),
      prisma.workerManager.findMany({ orderBy: { lastSeenAt: "desc" } }),
    ]);
    const online = await onlineManagersByWorker(now);
    return {
      items: workers.map((worker) => toWorker(worker, online.get(worker.name) ?? 0)),
      managers: managers.map((manager) => toWorkerManager(manager, now)),
    };
  },

  async update(id: string, body: UpdateWorkerBody): Promise<Worker> {
    await findWorker(id);
    const updated = await prisma.worker.update({ where: { id }, data: body });
    const online = await onlineManagersByWorker(new Date());
    return toWorker(updated, online.get(updated.name) ?? 0);
  },

  async remove(id: string): Promise<void> {
    await findWorker(id);
    if ((await prisma.pipelineStep.count({ where: { workerId: id } })) > 0) {
      throw HttpError.conflict("A pipeline still uses this worker", "WORKER_IN_USE");
    }
    await prisma.worker.delete({ where: { id } });
  },

  /**
   * A manager's lease request is its registration: the manager row is upserted and every worker
   * it offers is registered. A worker's manifest (`worker_specs`) sets its capabilities each time
   * (the last manager to announce them wins); display name, description and rate cap are taken
   * from it only when the worker is new, since admins own them afterwards.
   */
  async recordManager(request: ManagerLeaseRequest, now = new Date()): Promise<void> {
    const manager = {
      version: request.version,
      workers: request.workers,
      maxParallel: request.max_parallel,
      lastSeenAt: now,
    };
    await prisma.workerManager.upsert({
      where: { managerId: request.manager_id },
      create: { managerId: request.manager_id, firstSeenAt: now, ...manager },
      update: manager,
    });
    if (request.workers.length === 0) return;

    const specs = new Map((request.worker_specs ?? []).map((spec) => [spec.name, spec]));
    const stored = new Map(
      (await prisma.worker.findMany({ where: { name: { in: request.workers } } })).map((row) => [row.name, row]),
    );
    for (const name of request.workers) {
      const spec = specs.get(name);
      const wanted = spec ? capabilities(spec) : undefined;
      const row = stored.get(name);
      if (!row) {
        // skipDuplicates: another manager may register the same worker at the same moment.
        await prisma.worker.createMany({
          data: [
            {
              name,
              displayName: spec?.display_name ?? name,
              description: spec?.description ?? "",
              ...(spec?.max_rate === undefined ? {} : { maxRate: spec.max_rate }),
              ...wanted,
            },
          ],
          skipDuplicates: true,
        });
      } else if (wanted && !sameCapabilities(row, wanted)) {
        await prisma.worker.update({ where: { id: row.id }, data: wanted });
      }
    }
  },
};
