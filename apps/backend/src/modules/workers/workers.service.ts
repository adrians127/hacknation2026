import {
  validateStepParams,
  type WorkerParamField,
} from "@subsurf/contracts/workers/worker-catalog";
import type {
  UpdateWorkerBody,
  Worker,
  WorkerListResponse,
} from "@subsurf/contracts/workers/worker-registry.schema";
import type { ManagerLeaseRequest } from "@subsurf/contracts/workers/workers.schema";

import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import {
  isManagerOnline,
  toWorker,
  toWorkerManager,
  workerFields,
} from "~backend/modules/workers/workers.mapper";

const BUILTIN_EDITABLE = new Set<string>(["enabled", "maxRate", "defaults"]);

function assertDefaultsMatch(fields: readonly WorkerParamField[], defaults: Record<string, unknown>) {
  const issues = validateStepParams(fields, defaults);
  if (issues.length > 0) {
    const list = issues.map((issue) => `${issue.key} (${issue.code})`).join(", ");
    throw HttpError.badRequest(`Defaults do not match the worker's fields: ${list}`);
  }
}

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

export const workersService = {
  async list(now = new Date()): Promise<WorkerListResponse> {
    const [workers, managers] = await Promise.all([
      prisma.worker.findMany({ orderBy: [{ stage: "asc" }, { name: "asc" }] }),
      prisma.workerManager.findMany({ orderBy: { lastSeenAt: "desc" } }),
    ]);
    const online = await onlineManagersByWorker(now);
    return {
      items: workers.map((worker) => toWorker(worker, online.get(worker.name) ?? 0)),
      managers: managers.map((manager) => toWorkerManager(manager, now)),
    };
  },

  async update(id: string, body: UpdateWorkerBody): Promise<Worker> {
    const worker = await findWorker(id);
    if (worker.isBuiltin) {
      const locked = Object.keys(body).filter((key) => !BUILTIN_EDITABLE.has(key));
      if (locked.length > 0) {
        throw HttpError.conflict(
          `A built-in worker's ${locked.join(", ")} come from the code catalog`,
          "WORKER_BUILTIN",
        );
      }
    }
    const fields = body.paramFields ?? workerFields(worker);
    if (body.defaults) assertDefaultsMatch(fields, body.defaults);
    else if (body.paramFields) assertDefaultsMatch(fields, {});

    const updated = await prisma.worker.update({
      where: { id },
      data: {
        ...body,
        // New fields drop the old defaults unless new ones came along.
        ...(body.paramFields && !body.defaults ? { defaults: {} } : {}),
      },
    });
    const online = await onlineManagersByWorker(new Date());
    return toWorker(updated, online.get(updated.name) ?? 0);
  },

  async remove(id: string): Promise<void> {
    const worker = await findWorker(id);
    if (worker.isBuiltin) {
      throw HttpError.conflict("A built-in worker cannot be deleted; disable it instead", "WORKER_BUILTIN");
    }
    if ((await prisma.pipelineStep.count({ where: { workerId: id } })) > 0) {
      throw HttpError.conflict("A pipeline still uses this worker", "WORKER_IN_USE");
    }
    await prisma.worker.delete({ where: { id } });
  },

  /**
   * A manager's lease request is its registration: the manager row is upserted and worker names
   * the registry lacks become disabled custom workers for an admin to describe and enable.
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
    if (request.workers.length > 0) {
      await prisma.worker.createMany({
        data: request.workers.map((name) => ({ name, displayName: name, enabled: false })),
        skipDuplicates: true,
      });
    }
  },
};
