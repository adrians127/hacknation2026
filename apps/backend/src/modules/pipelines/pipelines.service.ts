import {
  ScheduleSchema,
  type Pipeline,
  type PipelineBody,
  type PipelineDetail,
  type PipelineStep,
  type Schedule,
  type UpdatePipelineBody,
} from "@subsurf/contracts/pipelines/pipelines.schema";
import { isPortSpecWithin } from "@subsurf/contracts/scans/port-spec";
import { validateStepParams } from "@subsurf/contracts/workers/worker-catalog";

import { env } from "~backend/config/env";
import { Prisma, type Scan } from "~backend/generated/prisma/client";
import type { AuthContext } from "~backend/lib/auth-context";
import { HttpError } from "~backend/lib/http-error";
import { isUniqueViolation, prisma } from "~backend/lib/prisma";
import { ACTIVE_SCAN_STATUSES } from "~backend/modules/pipelines/pipeline-runs.service";
import {
  PIPELINE_INCLUDE,
  toPipeline,
  toPipelineRun,
  type PipelineRow,
} from "~backend/modules/pipelines/pipelines.mapper";
import { nextFireAfter } from "~backend/modules/pipelines/schedule";
import { workerFields, workerInputs, workerSplitStrategies } from "~backend/modules/workers/workers.mapper";

const RECENT_RUNS = 10;

/** Checks every step against its worker and the scanner's limits (PDF: allowed ports, limited rate). */
async function assertStepsValid(steps: readonly PipelineStep[]): Promise<void> {
  const workers = await prisma.worker.findMany({
    where: { id: { in: [...new Set(steps.map((step) => step.workerId))] } },
  });
  const byId = new Map(workers.map((worker) => [worker.id, worker]));
  for (const [index, step] of steps.entries()) {
    const label = `Step ${index + 1}`;
    const worker = byId.get(step.workerId);
    if (!worker) throw HttpError.badRequest(`${label}: unknown worker`);
    if (!worker.enabled) {
      throw HttpError.badRequest(`${label}: the ${worker.name} worker is disabled`, "WORKER_DISABLED");
    }
    const input = step.input === "targets" ? "targets" : "hosts";
    if (!workerInputs(worker).includes(input)) {
      throw HttpError.badRequest(`${label}: ${worker.name} cannot take ${step.input === "targets" ? "address ranges" : "an earlier step's hosts"}`);
    }
    if (!workerSplitStrategies(worker).includes(step.split.strategy)) {
      throw HttpError.badRequest(`${label}: ${worker.name} cannot be split by ${step.split.strategy}`);
    }
    const issues = validateStepParams(workerFields(worker), step.params);
    if (issues.length > 0) {
      const list = issues.map((issue) => `${issue.key} (${issue.code})`).join(", ");
      throw HttpError.badRequest(`${label}: invalid params: ${list}`);
    }
    if (step.rate > worker.maxRate) {
      throw HttpError.badRequest(`${label}: ${worker.name} may send at most ${worker.maxRate} packets per second`);
    }
    if (!isPortSpecWithin(step.ports, env.SCAN_ALLOWED_PORTS)) {
      throw HttpError.badRequest(
        `${label}: only ports ${env.SCAN_ALLOWED_PORTS} may be scanned`,
        "PORTS_NOT_ALLOWED",
      );
    }
  }
}

function nextRunAt(enabled: boolean, schedule: Schedule | null): Date | null {
  if (!enabled || !schedule) return null;
  const next = nextFireAfter(schedule, new Date());
  if (!next) throw HttpError.badRequest("The schedule never runs: no run time falls on its days");
  return next;
}

/** Key-order-independent equality for the stored schedule JSON. */
function sameJson(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .toSorted(([x], [y]) => x.localeCompare(y))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function assertCanSchedule(auth: AuthContext): void {
  if (!auth.permissions.includes("scans:run")) {
    throw HttpError.forbidden("Changing a pipeline's schedule needs scans:run");
  }
}

const stepRows = (steps: readonly PipelineStep[]) =>
  steps.map((step, index) => ({
    position: index + 1,
    workerId: step.workerId,
    input: step.input,
    targetSelector: step.input === "targets" && step.targets ? step.targets : Prisma.DbNull,
    ports: step.ports,
    rate: step.rate,
    batchSize: step.batchSize,
    maxDurationSeconds: step.maxDurationSeconds,
    split: step.split,
    params: step.params,
  }));

function rethrowNameTaken(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw HttpError.conflict("A pipeline with this name already exists", "PIPELINE_NAME_TAKEN");
  }
  throw error;
}

async function findRow(id: string): Promise<PipelineRow> {
  const row = await prisma.pipeline.findUnique({ where: { id }, include: PIPELINE_INCLUDE });
  if (!row) throw HttpError.notFound("Pipeline not found");
  return row;
}

const byPipeline = (scans: Scan[]) => new Map(scans.map((scan) => [scan.pipelineId, scan]));

/** The newest run and the active run of each pipeline. */
async function runsOf(ids: readonly string[]) {
  const [last, active] = await Promise.all([
    prisma.scan.findMany({
      where: { pipelineId: { in: [...ids] } },
      orderBy: { createdAt: "desc" },
      distinct: ["pipelineId"],
    }),
    prisma.scan.findMany({
      where: { pipelineId: { in: [...ids] }, status: { in: ACTIVE_SCAN_STATUSES } },
      orderBy: { createdAt: "desc" },
      distinct: ["pipelineId"],
    }),
  ]);
  const lastBy = byPipeline(last);
  const activeBy = byPipeline(active);
  return (id: string) => ({ last: lastBy.get(id), active: activeBy.get(id) });
}

async function present(row: PipelineRow): Promise<Pipeline> {
  return toPipeline(row, (await runsOf([row.id]))(row.id));
}

export const pipelinesService = {
  async list(): Promise<Pipeline[]> {
    const rows = await prisma.pipeline.findMany({ include: PIPELINE_INCLUDE, orderBy: { name: "asc" } });
    const runs = await runsOf(rows.map((row) => row.id));
    return rows.map((row) => toPipeline(row, runs(row.id)));
  },

  async get(id: string): Promise<PipelineDetail> {
    const row = await findRow(id);
    const recent = await prisma.scan.findMany({
      where: { pipelineId: id },
      orderBy: { createdAt: "desc" },
      take: RECENT_RUNS,
    });
    return { ...(await present(row)), runs: recent.map(toPipelineRun) };
  },

  async create(auth: AuthContext, body: PipelineBody): Promise<Pipeline> {
    if (body.enabled) assertCanSchedule(auth);
    await assertStepsValid(body.steps);
    const row = await prisma.pipeline
      .create({
        data: {
          name: body.name,
          description: body.description,
          enabled: body.enabled,
          schedule: body.schedule ?? undefined,
          nextRunAt: nextRunAt(body.enabled, body.schedule),
          createdById: auth.user.id,
          steps: { create: stepRows(body.steps) },
        },
        include: PIPELINE_INCLUDE,
      })
      .catch(rethrowNameTaken);
    return present(row);
  },

  async update(auth: AuthContext, id: string, body: UpdatePipelineBody): Promise<Pipeline> {
    const current = await findRow(id);
    const stored = ScheduleSchema.safeParse(current.schedule);
    const schedule = body.schedule === undefined ? (stored.success ? stored.data : null) : body.schedule;
    const enabled = body.enabled ?? current.enabled;
    const changesSchedule =
      (body.enabled !== undefined && body.enabled !== current.enabled) ||
      (body.schedule !== undefined && !sameJson(body.schedule, current.schedule));
    if (changesSchedule) assertCanSchedule(auth);
    if (enabled && !schedule) {
      throw HttpError.badRequest("Only a pipeline with a schedule can be enabled");
    }
    if (body.steps) await assertStepsValid(body.steps);

    const data: Prisma.PipelineUpdateInput = {
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      ...(body.schedule === undefined ? {} : { schedule: body.schedule ?? Prisma.DbNull }),
      nextRunAt: changesSchedule ? nextRunAt(enabled, schedule) : undefined,
    };
    const row = await prisma
      .$transaction(async (tx) => {
        if (body.steps) {
          await tx.pipelineStep.deleteMany({ where: { pipelineId: id } });
          await tx.pipelineStep.createMany({
            data: stepRows(body.steps).map((step) => ({ ...step, pipelineId: id })),
          });
        }
        return tx.pipeline.update({ where: { id }, data, include: PIPELINE_INCLUDE });
      })
      .catch(rethrowNameTaken);
    return present(row);
  },

  async remove(id: string): Promise<void> {
    await findRow(id);
    await prisma.pipeline.delete({ where: { id } });
  },
};
