import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import { WorkerSchema } from "@subsurf/contracts/workers/worker-registry.schema";

import { prisma } from "~backend/lib/prisma";
import { workersService } from "~backend/modules/workers/workers.service";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";
import { createPipeline } from "~backend/test/pipelines";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const errorCode = async (res: Response) => ErrorResponseSchema.parse(await res.json()).error.code;

async function customWorker(name = "httpx") {
  await workersService.recordManager({
    manager_id: "scan-host-1",
    version: "0.1.0",
    workers: [name],
    max_parallel: 2,
  });
  return prisma.worker.findUniqueOrThrow({ where: { name } });
}

describe("PATCH /v1/workers/:id", () => {
  it("lets an admin disable a built-in worker and set its rate cap and defaults", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const masscan = await prisma.worker.findUniqueOrThrow({ where: { name: "masscan" } });

    const res = await client.patch(`/v1/workers/${masscan.id}`, {
      body: { enabled: false, maxRate: 5000, defaults: { wait_seconds: 10 } },
    });

    expect(res.status).toBe(200);
    expect(WorkerSchema.parse(await res.json())).toMatchObject({
      enabled: false,
      maxRate: 5000,
      defaults: { wait_seconds: 10 },
    });
  });

  it("refuses defaults that do not fit the fields, and a built-in's definition", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const masscan = await prisma.worker.findUniqueOrThrow({ where: { name: "masscan" } });

    const badDefaults = await client.patch(`/v1/workers/${masscan.id}`, {
      body: { defaults: { wait_seconds: 600 } },
    });
    const definition = await client.patch(`/v1/workers/${masscan.id}`, { body: { stage: 1 } });

    expect(badDefaults.status).toBe(400);
    expect([definition.status, await errorCode(definition)]).toEqual([409, "WORKER_BUILTIN"]);
  });

  it("lets an admin describe and enable a worker a manager registered", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const httpx = await customWorker();

    const res = await client.patch(`/v1/workers/${httpx.id}`, {
      body: {
        enabled: true,
        displayName: "HTTP probe",
        stage: 30,
        inputs: ["hosts"],
        paramFields: [{ key: "timeout_ms", label: "Timeout", type: "integer", min: 100, max: 60000 }],
        defaults: { timeout_ms: 5000 },
      },
    });

    expect(res.status).toBe(200);
    expect(WorkerSchema.parse(await res.json())).toMatchObject({
      name: "httpx",
      isBuiltin: false,
      enabled: true,
      inputs: ["hosts"],
      defaults: { timeout_ms: 5000 },
    });
  });
});

describe("DELETE /v1/workers/:id", () => {
  it("deletes only a custom worker no pipeline uses", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const masscan = await prisma.worker.findUniqueOrThrow({ where: { name: "masscan" } });
    const unused = await customWorker("unused");
    await createPipeline();

    const builtin = await client.delete(`/v1/workers/${masscan.id}`);
    const removed = await client.delete(`/v1/workers/${unused.id}`);

    expect([builtin.status, await errorCode(builtin)]).toEqual([409, "WORKER_BUILTIN"]);
    expect(removed.status).toBe(204);
    expect(await prisma.worker.findUnique({ where: { name: "unused" } })).toBeNull();
  });

  it("refuses a custom worker a pipeline still uses", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const httpx = await customWorker();
    await prisma.worker.update({ where: { id: httpx.id }, data: { enabled: true, inputs: ["hosts"] } });
    const pipelineId = await createPipeline();
    await prisma.pipelineStep.create({
      data: {
        pipelineId,
        position: 3,
        workerId: httpx.id,
        input: "previous",
        ports: "80,443",
        rate: 10,
        batchSize: 256,
        maxDurationSeconds: 600,
        split: { strategy: "none" },
      },
    });

    const res = await client.delete(`/v1/workers/${httpx.id}`);

    expect([res.status, await errorCode(res)]).toEqual([409, "WORKER_IN_USE"]);
  });
});
