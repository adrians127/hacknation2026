import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import {
  PipelineDetailSchema,
  PipelineSchema,
  SchedulePreviewResponseSchema,
} from "@subsurf/contracts/pipelines/pipelines.schema";

import { prisma } from "~backend/lib/prisma";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";
import { HOURLY_UTC, createPipeline, pipelineBody, stepBody } from "~backend/test/pipelines";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const errorCode = async (res: Response) => ErrorResponseSchema.parse(await res.json()).error.code;

describe("POST /v1/pipelines", () => {
  it("creates a pipeline from worker steps", async () => {
    const { client } = await signInAs(server, { role: "editor" });

    const res = await client.post("/v1/pipelines", { body: await pipelineBody({ name: "Nightly" }) });

    expect(res.status).toBe(201);
    const pipeline = PipelineSchema.parse(await res.json());
    expect(pipeline).toMatchObject({ name: "Nightly", enabled: false, nextRunAt: null, lastRun: null });
    expect(pipeline.steps.map((step) => [step.position, step.worker.name, step.input])).toEqual([
      [1, "masscan", "targets"],
      [2, "nmap", "previous"],
    ]);
  });

  it("schedules an enabled pipeline, which needs scans:run", async () => {
    const body = await pipelineBody({ enabled: true, schedule: HOURLY_UTC });
    const role = await prisma.role.create({
      data: { name: "Pipeline author", permissions: ["pipelines:read", "pipelines:create"] },
    });
    const { client: author } = await signInAs(server, { roleId: role.id });
    const { client: editor } = await signInAs(server, { role: "editor" });

    const refused = await author.post("/v1/pipelines", { body });
    const res = await editor.post("/v1/pipelines", { body });

    expect(refused.status).toBe(403);
    expect(res.status).toBe(201);
    const { nextRunAt } = PipelineSchema.parse(await res.json());
    expect(nextRunAt).toMatch(/T\d{2}:00:00\.000Z$/);
    expect(Date.parse(nextRunAt ?? "")).toBeGreaterThan(Date.now());
  });

  it("rejects steps the worker or the scanner limits do not allow", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const masscan = await stepBody("masscan");
    const nmap = await stepBody("nmap");

    const cases = [
      [masscan, { ...nmap, rate: 101 }],
      [{ ...masscan, ports: "22,60001" }],
      [masscan, { ...masscan, input: "previous" as const }],
      [{ ...masscan, params: { shard: 2 } }],
      [{ ...masscan, params: { wait_seconds: 61 } }],
      [{ ...masscan, split: { strategy: "chunk" as const } }],
    ];
    const results = [];
    for (const steps of cases) {
      const res = await client.post("/v1/pipelines", { body: await pipelineBody({ steps }) });
      results.push([res.status, await errorCode(res)]);
    }

    expect(results).toEqual([
      [400, undefined],
      [400, "PORTS_NOT_ALLOWED"],
      [400, undefined],
      [400, undefined],
      [400, undefined],
      [400, undefined],
    ]);
    expect(await prisma.pipeline.count()).toBe(0);
  });

  it("rejects a disabled worker", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    await prisma.worker.update({ where: { name: "nmap" }, data: { enabled: false } });

    const res = await client.post("/v1/pipelines", { body: await pipelineBody() });

    expect([res.status, await errorCode(res)]).toEqual([400, "WORKER_DISABLED"]);
  });

  it("refuses a second pipeline with the same name", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    await client.post("/v1/pipelines", { body: await pipelineBody({ name: "Twice" }) });

    const res = await client.post("/v1/pipelines", { body: await pipelineBody({ name: "Twice" }) });

    expect([res.status, await errorCode(res)]).toEqual([409, "PIPELINE_NAME_TAKEN"]);
  });
});

describe("PATCH /v1/pipelines/:id", () => {
  it("lets an analyst change the steps but not the schedule", async () => {
    const id = await createPipeline({ schedule: HOURLY_UTC });
    const { client } = await signInAs(server, { role: "analyst" });

    const steps = await client.patch(`/v1/pipelines/${id}`, {
      body: { steps: [await stepBody("masscan", { rate: 500 })], schedule: HOURLY_UTC },
    });
    const enable = await client.patch(`/v1/pipelines/${id}`, { body: { enabled: true } });
    const reschedule = await client.patch(`/v1/pipelines/${id}`, {
      body: { schedule: { ...HOURLY_UTC, every: 2 } },
    });

    expect([steps.status, enable.status, reschedule.status]).toEqual([200, 403, 403]);
    const pipeline = PipelineSchema.parse(await steps.json());
    expect(pipeline.steps.map((step) => [step.worker.name, step.rate])).toEqual([["masscan", 500]]);
    expect(pipeline.nextRunAt).toBeNull();
  });

  it("computes the next run when an editor enables the schedule, and clears it when disabled", async () => {
    const id = await createPipeline({ schedule: HOURLY_UTC });
    const { client } = await signInAs(server, { role: "editor" });

    const enabled = PipelineSchema.parse(
      await (await client.patch(`/v1/pipelines/${id}`, { body: { enabled: true } })).json(),
    );
    const disabled = PipelineSchema.parse(
      await (await client.patch(`/v1/pipelines/${id}`, { body: { enabled: false } })).json(),
    );

    expect(enabled.nextRunAt).not.toBeNull();
    expect(disabled.nextRunAt).toBeNull();
  });

  it("refuses to enable a pipeline without a schedule", async () => {
    const id = await createPipeline();
    const { client } = await signInAs(server, { role: "editor" });

    const res = await client.patch(`/v1/pipelines/${id}`, { body: { enabled: true } });

    expect(res.status).toBe(400);
  });
});

describe("GET and DELETE /v1/pipelines/:id", () => {
  it("shows a pipeline to a viewer and deletes it for an editor", async () => {
    const id = await createPipeline({ name: "Kept scans" });
    const { client: viewer } = await signInAs(server, { role: "viewer" });
    const { client: editor } = await signInAs(server, { role: "editor" });

    const detail = PipelineDetailSchema.parse(await (await viewer.get(`/v1/pipelines/${id}`)).json());
    const removed = await editor.delete(`/v1/pipelines/${id}`);

    expect(detail).toMatchObject({ name: "Kept scans", runs: [] });
    expect(removed.status).toBe(204);
    expect(await prisma.pipeline.count()).toBe(0);
  });
});

describe("POST /v1/pipelines/schedule/preview", () => {
  it("lists the next run times", async () => {
    const { client } = await signInAs(server, { role: "viewer" });

    const res = await client.post("/v1/pipelines/schedule/preview", {
      body: { schedule: HOURLY_UTC, count: 3 },
    });

    const { times } = SchedulePreviewResponseSchema.parse(await res.json());
    expect(times).toHaveLength(3);
    expect(Date.parse(times[1]) - Date.parse(times[0])).toBe(3_600_000);
  });
});
