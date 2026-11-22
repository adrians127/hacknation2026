import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { WorkerListResponseSchema } from "@subsurf/contracts/workers/worker-registry.schema";
import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";
import { ManagerJobListSchema, type ManagerJob } from "@subsurf/contracts/workers/workers.schema";

import { prisma } from "~backend/lib/prisma";
import { pipelineRuns } from "~backend/modules/pipelines/pipeline-runs.service";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";
import { addTargets, createPipeline } from "~backend/test/pipelines";
import { TEST_ENV } from "~backend/test/test-env";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const MANAGER = {
  manager_id: "scan-host-1",
  version: "0.1.0",
  workers: ["masscan", "nmap"],
  max_parallel: 1,
  wait_seconds: 0,
};

function post(path: string, body: unknown, token: string | null = TEST_ENV.WORKER_TOKEN) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return fetch(`${server.baseUrl}/v1/workers/manager${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function lease(overrides: Partial<typeof MANAGER> = {}): Promise<ManagerJob[]> {
  const res = await post("/lease", { ...MANAGER, ...overrides });
  if (res.status === 204) return [];
  expect(res.status).toBe(200);
  return ManagerJobListSchema.parse(await res.json()).jobs;
}

/** A queued run of a masscan → nmap pipeline over `targets`. */
async function queuedRun(targets: string[]): Promise<string> {
  await addTargets(targets);
  const pipelineId = await createPipeline();
  const { scan } = await pipelineRuns.start(pipelineId, {
    trigger: "manual",
    requestedById: (await prisma.pipeline.findUniqueOrThrow({ where: { id: pipelineId } })).createdById,
    windowEndsAt: null,
  });
  return scan.id;
}

describe("POST /v1/workers/manager/lease", () => {
  it("refuses a missing or wrong token", async () => {
    for (const token of [null, "not-the-worker-token-at-all"]) {
      expect((await post("/lease", MANAGER, token)).status).toBe(401);
    }
    expect(await prisma.workerManager.count()).toBe(0);
  });

  it("registers the manager and the workers the registry lacks", async () => {
    const jobs = await lease({ workers: ["masscan", "nmap", "httpx"] });
    const { client } = await signInAs(server, { role: "viewer" });

    const { items, managers } = WorkerListResponseSchema.parse(await (await client.get("/v1/workers")).json());

    expect(jobs).toEqual([]);
    expect(managers).toMatchObject([{ managerId: "scan-host-1", maxParallel: 1, isOnline: true }]);
    expect(items.map((worker) => [worker.name, worker.isBuiltin, worker.enabled, worker.onlineManagers])).toEqual([
      ["masscan", true, true, 1],
      ["nmap", true, true, 1],
      ["httpx", false, false, 1],
    ]);
  });

  it("leases queued jobs of offered, enabled workers, never twice", async () => {
    const scanId = await queuedRun(["10.0.0.0/22"]);

    const none = await lease({ workers: ["nmap"] });
    const [first, second] = await Promise.all([lease(), lease()]);
    const rest = await lease({ max_parallel: 4 });

    expect(none).toEqual([]);
    const ids = [...first, ...second, ...rest].map((job) => job.job_id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    expect(await lease()).toEqual([]);
    const [job] = first.length > 0 ? first : second;
    expect(job).toMatchObject({ scan_id: scanId, worker: "masscan", split: { strategy: "none" } });
    expect(await prisma.scanJob.count({ where: { status: "leased", leasedBy: "scan-host-1" } })).toBe(4);
    expect((await prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).status).toBe("running");
  });

  it("holds back the jobs of a paused scan or a disabled worker", async () => {
    const scanId = await queuedRun(["10.0.0.0/24"]);
    await prisma.scan.update({ where: { id: scanId }, data: { status: "paused" } });
    const paused = await lease();
    await prisma.scan.update({ where: { id: scanId }, data: { status: "running" } });
    await prisma.worker.update({ where: { name: "masscan" }, data: { enabled: false } });
    const disabled = await lease();

    expect([paused, disabled]).toEqual([[], []]);
  });
});

describe("POST /v1/workers/manager/results", () => {
  it("completes a job once every task reported, and queues nmap on the hosts it found", async () => {
    const scanId = await queuedRun(["10.0.5.0/24"]);
    const [job] = await lease();
    const result = buildWorkerResult({ scanId, jobId: job.job_id, leaseId: job.lease_id });

    await post("/results", { task_index: 1, task_count: 2, result });
    const afterOne = await prisma.scanJob.findUniqueOrThrow({ where: { id: job.job_id } });
    const upload = await post("/results", { task_index: 2, task_count: 2, result });

    expect(upload.status).toBe(200);
    expect(afterOne.status).toBe("leased");
    const jobs = await prisma.scanJob.findMany({ orderBy: { sequence: "asc" } });
    expect(jobs.map((row) => [row.sequence, row.stepIndex, row.worker, row.kind, row.status])).toEqual([
      [1, 1, "masscan", "discovery", "completed"],
      [2, 2, "nmap", "service", "queued"],
    ]);
    expect(jobs[1]).toMatchObject({ targets: ["10.0.5.7"], subnet: "10.0.5.7", addressCount: 1 });
    expect(jobs[1].params).toMatchObject({ targets: [{ ip: "10.0.5.7", ports: [22, 443], domains: [] }] });

    const [service] = await lease();
    expect(service).toMatchObject({ job_id: jobs[1].id, worker: "nmap" });
  });

  it("ends the scan when its last job completes without hits for the next step", async () => {
    const scanId = await queuedRun(["10.0.5.0/24"]);
    const [job] = await lease();
    const result = buildWorkerResult({ scanId, jobId: job.job_id, leaseId: job.lease_id });
    result.hosts = result.hosts.map((host) => ({ ...host, status: "down", ports: [] }));

    await post("/results", { task_index: 1, task_count: 1, result });

    const scan = await prisma.scan.findUniqueOrThrow({ where: { id: scanId } });
    expect(scan.status).toBe("completed");
    expect(scan.finishedAt).not.toBeNull();
  });
});
