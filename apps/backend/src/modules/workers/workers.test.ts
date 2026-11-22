import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";
import type { WorkerResult } from "@subsurf/contracts/workers/worker-result.schema";
import { ManagerResultUploadResponseSchema } from "@subsurf/contracts/workers/workers.schema";

import { prisma } from "~backend/lib/prisma";
import { createUser } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";
import { TEST_ENV } from "~backend/test/test-env";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

async function exampleResult(): Promise<WorkerResult> {
  const user = await createUser({ role: "admin" });
  const scan = await prisma.scan.create({
    data: {
      ports: "21-23,80,443,8000-8100",
      maxRate: 100,
      batchSize: 256,
      targetCount: 1,
      addressCount: 256,
      jobCount: 1,
      requestedById: user.id,
    },
  });
  const job = await prisma.scanJob.create({
    data: {
      scanId: scan.id,
      sequence: 1,
      subnet: "10.0.5.0/24",
      targets: ["10.0.5.0/24"],
      addressCount: 256,
    },
  });
  return buildWorkerResult({ scanId: scan.id, jobId: job.id, leaseId: randomUUID() });
}

interface UploadOptions {
  token?: string | null;
  isGzipped?: boolean;
}

function upload(body: unknown, { token = TEST_ENV.WORKER_TOKEN, isGzipped = false }: UploadOptions = {}) {
  const json = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (isGzipped) headers["content-encoding"] = "gzip";
  return fetch(`${server.baseUrl}/v1/workers/manager/results`, {
    method: "POST",
    headers,
    body: isGzipped ? gzipSync(json) : json,
  });
}

describe("POST /workers/manager/results", () => {
  it("refuses a missing or wrong worker token", async () => {
    const body = { task_index: 1, task_count: 1, result: await exampleResult() };

    for (const token of [null, "not-the-worker-token-at-all"]) {
      const res = await upload(body, { token });
      expect(res.status).toBe(401);
    }
    expect(await prisma.scanJobResult.count()).toBe(0);
  });

  it("stores each task of a split lease on its own and ignores a resend", async () => {
    const result = await exampleResult();

    const first = await upload({ task_index: 1, task_count: 2, result });
    const second = await upload({ task_index: 2, task_count: 2, result });
    const resent = await upload({ task_index: 1, task_count: 2, result });

    expect([first.status, second.status, resent.status]).toEqual([200, 200, 200]);
    const [a, b, c] = await Promise.all(
      [first, second, resent].map(async (res) => ManagerResultUploadResponseSchema.parse(await res.json())),
    );
    expect([a.status, b.status, c.status]).toEqual(["ingested", "ingested", "duplicate"]);
    expect(b.resultId).not.toBe(a.resultId);
    expect(c.resultId).toBe(a.resultId);
    const stored = await prisma.scanJobResult.findMany({ orderBy: { taskIndex: "asc" } });
    expect(stored.map((row) => [row.id, row.taskIndex, row.taskCount])).toEqual([
      [a.resultId, 1, 2],
      [b.resultId, 2, 2],
    ]);
  });

  it("rejects an invalid upload or a result for an unknown job", async () => {
    const result = await exampleResult();

    const badIndex = await upload({ task_index: 3, task_count: 2, result });
    const badResult = await upload({ task_index: 1, task_count: 1, result: { scan: result.scan } });
    const unknownJob = await upload({
      task_index: 1,
      task_count: 1,
      result: { ...result, scan: { ...result.scan, jobId: randomUUID() } },
    });

    expect([badIndex.status, badResult.status, unknownJob.status]).toEqual([400, 400, 404]);
    expect(await prisma.scanJobResult.count()).toBe(0);
  });

  it("accepts a gzip-compressed result above the global 1 MB body limit", async () => {
    const result = await exampleResult();
    const [endpoint] = result.hosts[0].ports[1].http;
    if (!endpoint.body) throw new Error("The example's endpoint has a body");
    endpoint.body.content = "x".repeat(1_500_000);

    const res = await upload({ task_index: 1, task_count: 1, result }, { isGzipped: true });

    expect(res.status).toBe(200);
    expect(await prisma.scanJobResult.count()).toBe(1);
  });
});
