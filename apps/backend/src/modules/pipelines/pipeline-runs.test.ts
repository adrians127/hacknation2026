import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import { RunPipelineResponseSchema } from "@subsurf/contracts/pipelines/pipelines.schema";

import { logger } from "~backend/lib/logger";
import { prisma } from "~backend/lib/prisma";
import { pipelineRuns } from "~backend/modules/pipelines/pipeline-runs.service";
import { tick } from "~backend/modules/pipelines/scheduler";
import { resolveDomains } from "~backend/modules/scans/dns";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";
import { HOURLY_UTC, TEST_PORTS, addTargets, createPipeline } from "~backend/test/pipelines";

// No real DNS in tests: a fixed zone.
vi.mock("~backend/modules/scans/dns", () => ({ resolveDomains: vi.fn<typeof resolveDomains>() }));

const ZONE: Record<string, string[]> = { "app.example.com": ["198.51.100.7"] };

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.mocked(resolveDomains).mockReset().mockImplementation(async (domains) => ({
    resolved: domains.flatMap((domain) => (ZONE[domain] ? [{ domain, addresses: ZONE[domain] }] : [])),
    warnings: [],
  }));
});

async function runNow(pipelineId: string) {
  const { client } = await signInAs(server, { role: "editor" });
  return client.post(`/v1/pipelines/${pipelineId}/runs`);
}

const errorCode = async (res: Response) => ErrorResponseSchema.parse(await res.json()).error.code;

describe("POST /v1/pipelines/:id/runs", () => {
  it("queues the tagged targets' first step with the steps snapshotted", async () => {
    await addTargets(["10.0.0.0/24", "app.example.com"], ["lab"]);
    await addTargets(["10.9.0.0/24"], ["other"]);
    const id = await createPipeline({ targets: { tags: ["lab"], targetIds: [], ranges: [] } });

    const res = await runNow(id);

    expect(res.status).toBe(201);
    const { scan } = RunPipelineResponseSchema.parse(await res.json());
    expect(scan).toMatchObject({ status: "queued", targetCount: 2, addressCount: 257, jobCount: 2 });
    const stored = await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(stored).toMatchObject({ pipelineId: id, trigger: "manual", windowEndsAt: null, ports: TEST_PORTS });
    const jobs = await prisma.scanJob.findMany({ orderBy: { sequence: "asc" } });
    expect(jobs.map((job) => [job.stepIndex, job.worker, job.kind, job.targets])).toEqual([
      [1, "masscan", "discovery", ["10.0.0.0/24"]],
      [1, "masscan", "discovery", ["198.51.100.7"]],
    ]);
    expect(jobs[0].params).toMatchObject({
      targets: ["10.0.0.0/24"],
      ports: TEST_PORTS,
      rate: 1000,
      wait_seconds: 3,
      retries: 0,
    });
  });

  it("narrows the run to the selector's ranges", async () => {
    await addTargets(["10.0.0.0/24", "app.example.com"]);
    const id = await createPipeline({ targets: { tags: [], targetIds: [], ranges: ["10.0.0.128/25"] } });

    const { scan } = RunPipelineResponseSchema.parse(await (await runNow(id)).json());

    expect(scan).toMatchObject({ targetCount: 1, addressCount: 128, jobCount: 1 });
    const [job] = await prisma.scanJob.findMany();
    expect(job.targets).toEqual(["10.0.0.128/25"]);
  });

  it("adds the targets picked by id to the tagged ones", async () => {
    await addTargets(["10.0.0.0/24"], ["lab"]);
    await addTargets(["10.8.0.0/24", "10.9.0.0/24"]);
    const picked = await prisma.target.findUniqueOrThrow({ where: { value: "10.9.0.0/24" } });
    const id = await createPipeline({ targets: { tags: ["lab"], targetIds: [picked.id], ranges: [] } });

    const { scan } = RunPipelineResponseSchema.parse(await (await runNow(id)).json());

    expect(scan).toMatchObject({ targetCount: 2, addressCount: 512 });
    const jobs = await prisma.scanJob.findMany({ orderBy: { sequence: "asc" } });
    expect(jobs.map((job) => job.targets)).toEqual([["10.0.0.0/24"], ["10.9.0.0/24"]]);
  });

  it("reads a selector saved before targets could be picked by id", async () => {
    await addTargets(["10.0.0.0/24"], ["lab"]);
    await addTargets(["10.9.0.0/24"]);
    const id = await createPipeline();
    await prisma.pipeline.update({ where: { id }, data: { targetSelector: { tags: ["lab"], ranges: [] } } });

    const { scan } = RunPipelineResponseSchema.parse(await (await runNow(id)).json());

    expect(scan).toMatchObject({ targetCount: 1, addressCount: 256 });
  });

  it("refuses a second run while one is active, and a run with nothing to scan", async () => {
    await addTargets(["10.0.0.0/24"], ["lab"]);
    const id = await createPipeline({ targets: { tags: ["lab"], targetIds: [], ranges: [] } });
    const empty = await createPipeline({ targets: { tags: ["nothing-has-this"], targetIds: [], ranges: [] } });

    await runNow(id);
    const again = await runNow(id);
    const nothing = await runNow(empty);

    expect([again.status, await errorCode(again)]).toEqual([409, "PIPELINE_RUN_ACTIVE"]);
    expect([nothing.status, await errorCode(nothing)]).toEqual([409, "NO_SCANNABLE_TARGETS"]);
  });

  it("refuses a run with a disabled worker", async () => {
    await addTargets(["10.0.0.0/24"]);
    const id = await createPipeline();
    await prisma.worker.update({ where: { name: "nmap" }, data: { enabled: false } });

    const res = await runNow(id);

    expect([res.status, await errorCode(res)]).toEqual([409, "WORKER_DISABLED"]);
  });
});

describe("POST /v1/scans/:id/stop", () => {
  it("stops the queued jobs and ends the scan, once", async () => {
    await addTargets(["10.0.0.0/23"]);
    const { scan } = RunPipelineResponseSchema.parse(await (await runNow(await createPipeline())).json());
    const { client } = await signInAs(server, { role: "editor" });

    const stop = await client.post(`/v1/scans/${scan.id}/stop`);
    const again = await client.post(`/v1/scans/${scan.id}/stop`);

    expect(stop.status).toBe(204);
    expect([again.status, await errorCode(again)]).toEqual([409, "SCAN_NOT_STOPPABLE"]);
    expect(await prisma.scanJob.findMany({ select: { status: true } })).toEqual([
      { status: "stopped" },
      { status: "stopped" },
    ]);
    const stored = await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } });
    expect(stored.status).toBe("stopped");
    expect(stored.finishedAt).not.toBeNull();
  });
});

const at = (time: string) => new Date(`2026-11-22T${time}:00Z`);

describe("scheduler tick", () => {
  it("starts a run in its window, pauses it when the window closes and resumes it at the next fire", async () => {
    await addTargets(["10.0.0.0/24"]);
    const id = await createPipeline({ enabled: true, schedule: HOURLY_UTC, nextRunAt: at("10:00") });

    await tick(logger, at("10:01"));
    const started = await prisma.scan.findFirstOrThrow({ where: { pipelineId: id } });
    const pipeline = await prisma.pipeline.findUniqueOrThrow({ where: { id } });
    await tick(logger, at("10:31"));
    const paused = await prisma.scan.findUniqueOrThrow({ where: { id: started.id } });
    await tick(logger, at("11:01"));
    const resumed = await prisma.scan.findUniqueOrThrow({ where: { id: started.id } });

    expect(started).toMatchObject({ trigger: "schedule", status: "queued", windowEndsAt: at("10:30") });
    expect(pipeline.nextRunAt).toEqual(at("11:00"));
    expect(paused.status).toBe("paused");
    expect(resumed).toMatchObject({ status: "queued", windowEndsAt: at("11:30") });
    expect(await prisma.scan.count()).toBe(1);
  });

  it("skips a fire while the run is still going", async () => {
    await addTargets(["10.0.0.0/24"]);
    const id = await createPipeline({
      enabled: true,
      schedule: { ...HOURLY_UTC, windowMinutes: null },
      nextRunAt: at("10:00"),
    });

    await tick(logger, at("10:01"));
    await tick(logger, at("11:01"));

    expect(await prisma.scan.count({ where: { pipelineId: id } })).toBe(1);
    expect((await prisma.pipeline.findUniqueOrThrow({ where: { id } })).nextRunAt).toEqual(at("12:00"));
  });

  it("skips a fire whose time window closed before the scheduler got to it", async () => {
    await addTargets(["10.0.0.0/24"]);
    const id = await createPipeline({ enabled: true, schedule: HOURLY_UTC, nextRunAt: at("10:00") });

    await tick(logger, at("10:45"));

    expect(await prisma.scan.count()).toBe(0);
    expect((await prisma.pipeline.findUniqueOrThrow({ where: { id } })).nextRunAt).toEqual(at("11:00"));
  });

  it("re-queues an expired lease, and fails the job after too many attempts", async () => {
    await addTargets(["10.0.0.0/23"]);
    const { scan } = RunPipelineResponseSchema.parse(await (await runNow(await createPipeline())).json());
    const [first, second] = await prisma.scanJob.findMany({ orderBy: { sequence: "asc" } });
    const expired = { status: "leased" as const, leaseExpiresAt: at("09:00") };
    await prisma.scanJob.update({ where: { id: first.id }, data: { ...expired, leaseId: "a", attempts: 1 } });
    await prisma.scanJob.update({ where: { id: second.id }, data: { ...expired, leaseId: "b", attempts: 3 } });

    const reclaimed = await pipelineRuns.reclaimExpiredLeases(at("10:00"));

    expect(reclaimed).toBe(2);
    const jobs = await prisma.scanJob.findMany({ orderBy: { sequence: "asc" } });
    expect(jobs.map((job) => [job.status, job.leaseId])).toEqual([
      ["queued", null],
      ["failed", null],
    ]);
    expect((await prisma.scan.findUniqueOrThrow({ where: { id: scan.id } })).finishedAt).toBeNull();
  });
});
