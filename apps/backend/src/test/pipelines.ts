import { randomUUID } from "node:crypto";

import type { PipelineBody, PipelineStep, Schedule } from "@subsurf/contracts/pipelines/pipelines.schema";

import { prisma } from "~backend/lib/prisma";
import { createUser } from "~backend/test/auth";

export async function workerId(name: "masscan" | "nmap"): Promise<string> {
  return (await prisma.worker.findUniqueOrThrow({ where: { name } })).id;
}

/** Covers the example worker result's open ports (docs/worker-result-format.md). */
export const TEST_PORTS = "21-23,80,443,3306,8000-8100";

export async function stepBody(
  name: "masscan" | "nmap",
  overrides: Partial<PipelineStep> = {},
): Promise<PipelineStep> {
  return {
    workerId: await workerId(name),
    input: name === "masscan" ? "targets" : "previous",
    ports: TEST_PORTS,
    rate: name === "masscan" ? 1000 : 100,
    batchSize: 256,
    maxDurationSeconds: 600,
    split: { strategy: "none" },
    params: {},
    ...overrides,
  };
}

/** masscan over the targets, then nmap on its hits; no schedule. */
export async function pipelineBody(overrides: Partial<PipelineBody> = {}): Promise<PipelineBody> {
  return {
    name: `Pipeline ${randomUUID()}`,
    description: "",
    enabled: false,
    targets: { tags: [], ranges: [] },
    steps: [await stepBody("masscan"), await stepBody("nmap")],
    schedule: null,
    ...overrides,
  };
}

export const HOURLY_UTC: Schedule = {
  every: 1,
  unit: "hour",
  startsAt: "2026-11-22T10:00",
  daysOfWeek: [],
  windowMinutes: 30,
  timezone: "UTC",
};

/** Straight into the database, skipping the API's checks. */
export async function createPipeline(
  overrides: Partial<PipelineBody> & { nextRunAt?: Date | null } = {},
): Promise<string> {
  const { nextRunAt = null, ...rest } = overrides;
  const body = await pipelineBody(rest);
  const owner = await createUser({ role: "editor" });
  const pipeline = await prisma.pipeline.create({
    data: {
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      targetSelector: body.targets,
      schedule: body.schedule ?? undefined,
      nextRunAt,
      createdById: owner.id,
      steps: { create: body.steps.map((step, index) => ({ ...step, position: index + 1 })) },
    },
  });
  return pipeline.id;
}

/** Inventory targets: IPv4 addresses, CIDRs or domains. */
export async function addTargets(values: readonly string[], tags: string[] = []): Promise<void> {
  const owner = await createUser({ role: "editor" });
  await prisma.target.createMany({
    data: values.map((value) => ({
      kind: value.includes("/") ? ("cidr" as const) : /^[\d.]+$/.test(value) ? ("ip" as const) : ("domain" as const),
      value,
      tags,
      createdById: owner.id,
    })),
  });
}
