import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";
import type { ObservedHost, WorkerResult } from "@subsurf/contracts/workers/worker-result.schema";

import { prisma } from "~backend/lib/prisma";
import { openPortDetails } from "~backend/modules/results/details";
import { resultsService } from "~backend/modules/results/results.service";
import { createUser } from "~backend/test/auth";

async function createJob() {
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
  return { scanId: scan.id, jobId: job.id };
}

async function exampleResult(): Promise<WorkerResult> {
  return buildWorkerResult({ ...(await createJob()), leaseId: randomUUID() });
}

function withHosts(result: WorkerResult, hosts: ObservedHost[]): WorkerResult {
  return { scan: { ...result.scan, leaseId: randomUUID() }, hosts };
}

describe("resultsService.ingest", () => {
  it("stores the example result as observations and assets", async () => {
    const result = await exampleResult();

    const outcome = await resultsService.ingest(result);

    expect(outcome).toMatchObject({ status: "ingested", hostsWritten: 4 });
    const stored = await prisma.scanJobResult.findUniqueOrThrow({
      where: { leaseId_taskIndex: { leaseId: result.scan.leaseId, taskIndex: 1 } },
    });
    expect(stored).toMatchObject({
      status: "partial",
      stopReason: "deadline",
      durationMs: 912000,
      taskCount: 1,
    });

    const observations = await prisma.hostObservation.findMany({
      orderBy: { ipNumber: "asc" },
      include: { hostnames: true, ports: { orderBy: { port: "asc" } } },
    });
    expect(observations.map((row) => [row.ip, row.status, row.ports.length])).toEqual([
      ["10.0.5.7", "up", 2],
      ["10.0.5.8", "down", 0],
      ["10.0.5.9", "timeout", 0],
      ["10.0.5.200", "cancelled", 0],
    ]);
    const [up] = observations;
    expect(up.hostnames.map((row) => `${row.source}:${row.name}`).toSorted()).toEqual([
      "job:wiki.example.org",
      "ptr:web01.example.org",
      "tls_san:wiki.example.org",
    ]);
    expect(up.ports[1]).toMatchObject({
      port: 443,
      serviceProduct: "nginx",
      serviceVersion: "1.24.0",
      serviceCpe: ["cpe:/a:nginx:nginx:1.24.0"],
    });

    expect(await prisma.host.count()).toBe(1);
    expect(await prisma.service.count()).toBe(2);
    expect(up.hostId).not.toBeNull();
  });

  it("encrypts the sensitive fields of details and keeps the rest queryable", async () => {
    const result = await exampleResult();
    await resultsService.ingest(result);

    const ports = await prisma.portObservation.findMany({ orderBy: { port: "asc" } });
    const raw = JSON.stringify(ports.map((port) => port.details));
    for (const secret of ["PHPSESSID", "x-powered-by", "SSH-2.0-OpenSSH", "/wp-admin/", "<!doctype"]) {
      expect(raw).not.toContain(secret);
    }
    const [ssh, https] = result.hosts[0].ports;
    for (const [row, port] of [
      [ports[0], ssh],
      [ports[1], https],
    ] as const) {
      expect(openPortDetails(row.details)).toEqual({
        identity: port.identity,
        banner: port.banner,
        scripts: port.scripts,
        tls: port.tls,
        http: port.http,
      });
    }

    // The GIN index serves containment queries on the plaintext part.
    const byTitle = await prisma.$queryRaw<{ port: number }[]>`
      SELECT port FROM "PortObservation"
      WHERE details @> ${JSON.stringify({ http: [{ title: "Wiki – login" }] })}::jsonb`;
    expect(byTitle).toEqual([{ port: 443 }]);
  });

  it("encrypts and restores a TLS-only certificate without an HTTP endpoint", async () => {
    const result = await exampleResult();
    const port = result.hosts[0].ports[1];
    port.http = [];
    port.tls = [{
      vhost: "wiki.example.org", version: "tls13", cipher: "TLS_AES_128_GCM_SHA256",
      alpn: null, cert: {
        subjectCn: "wiki.example.org", san: ["wiki.example.org"], issuer: "Secret Issuer",
        notBefore: "2026-01-01T00:00:00Z", notAfter: "2027-01-01T00:00:00Z",
        serial: "123", sha256: "a".repeat(64), selfSigned: null,
        keyAlgorithm: null, keyBits: null,
      },
    }];
    await resultsService.ingest(result);
    const stored = await prisma.portObservation.findFirstOrThrow({ where: { port: 443 } });
    expect(JSON.stringify(stored.details)).not.toContain("Secret Issuer");
    expect(openPortDetails(stored.details).tls).toEqual(port.tls);
    expect(openPortDetails(stored.details).http).toEqual([]);
  });

  it("ignores a result resent under the same lease", async () => {
    const result = await exampleResult();
    const first = await resultsService.ingest(result);

    const second = await resultsService.ingest(result);

    expect(second).toEqual({ status: "duplicate", resultId: first.resultId });
    expect(await prisma.scanJobResult.count()).toBe(1);
    expect(await prisma.hostObservation.count()).toBe(4);
  });

  it("keeps every task of a split lease as its own result", async () => {
    // Two masscan shards of one job: same lease, same addresses, one worker run each.
    const result = await exampleResult();
    const first = await resultsService.ingest(result, { taskIndex: 1, taskCount: 2 });
    const second = await resultsService.ingest(result, { taskIndex: 2, taskCount: 2 });
    const resent = await resultsService.ingest(result, { taskIndex: 2, taskCount: 2 });

    expect(first.status).toBe("ingested");
    expect(second.status).toBe("ingested");
    expect(resent).toEqual({ status: "duplicate", resultId: second.resultId });
    const stored = await prisma.scanJobResult.findMany({ orderBy: { taskIndex: "asc" } });
    expect(stored.map((row) => [row.leaseId, row.taskIndex, row.taskCount])).toEqual([
      [result.scan.leaseId, 1, 2],
      [result.scan.leaseId, 2, 2],
    ]);
    expect(await prisma.hostObservation.count()).toBe(8);
    expect(await prisma.host.count()).toBe(1);
  });

  it("preserves each worker run's observations, including inconclusive results", async () => {
    const result = await exampleResult();
    const first = await resultsService.ingest(result);
    const [up, down] = result.hosts;

    // A retry under a new lease: the cancelled address now answers, the down one times out.
    const outcome = await resultsService.ingest(
      withHosts(result, [
        { ...up, ip: "10.0.5.200", hostnames: [] },
        { ...down, status: "timeout", reason: null },
      ]),
    );

    expect(outcome).toMatchObject({ status: "ingested", hostsWritten: 2 });
    if (first.status !== "ingested" || outcome.status !== "ingested") {
      throw new Error("Expected two distinct worker results");
    }
    const observations = await prisma.hostObservation.findMany({
      where: { resultId: { in: [first.resultId, outcome.resultId] } },
      select: { resultId: true, ip: true, status: true, _count: { select: { ports: true } } },
    });
    expect(observations.filter((row) => row.resultId === first.resultId)).toEqual(
      expect.arrayContaining([
        { resultId: first.resultId, ip: "10.0.5.8", status: "down", _count: { ports: 0 } },
        {
          resultId: first.resultId,
          ip: "10.0.5.200",
          status: "cancelled",
          _count: { ports: 0 },
        },
      ]),
    );
    expect(observations.filter((row) => row.resultId === outcome.resultId)).toEqual(
      expect.arrayContaining([
        { resultId: outcome.resultId, ip: "10.0.5.8", status: "timeout", _count: { ports: 0 } },
        { resultId: outcome.resultId, ip: "10.0.5.200", status: "up", _count: { ports: 2 } },
      ]),
    );
  });

  it("keeps an earlier open port when a later worker reports the host down", async () => {
    const result = await exampleResult();
    const first = await resultsService.ingest(result);
    const down = { ...result.hosts[1], ip: result.hosts[0].ip };
    const second = await resultsService.ingest(withHosts(result, [down]));
    if (first.status !== "ingested" || second.status !== "ingested") {
      throw new Error("Expected two distinct worker results");
    }

    const observations = await prisma.hostObservation.findMany({
      where: { scanId: result.scan.scanId, ip: down.ip },
      select: { resultId: true, status: true, _count: { select: { ports: true } } },
    });
    expect(observations).toEqual(
      expect.arrayContaining([
        { resultId: first.resultId, status: "up", _count: { ports: 2 } },
        { resultId: second.resultId, status: "down", _count: { ports: 0 } },
      ]),
    );
    expect(observations).toHaveLength(2);
    expect(await prisma.portObservation.count()).toBe(2);
  });

  it("widens the seen window across scans and keeps user edits", async () => {
    const first = await exampleResult();
    await resultsService.ingest(first);
    await prisma.host.update({ where: { ip: "10.0.5.7" }, data: { note: "wiki server", tags: ["web"] } });

    const later = await exampleResult();
    later.hosts[0].observedAt = "2026-11-28T14:03:11Z";
    await resultsService.ingest(later);
    const earlier = await exampleResult();
    earlier.hosts[0].observedAt = "2026-11-14T14:03:11Z";
    await resultsService.ingest(earlier);

    const host = await prisma.host.findUniqueOrThrow({
      where: { ip: "10.0.5.7" },
      include: { services: { include: { _count: { select: { observations: true } } } } },
    });
    expect(host).toMatchObject({
      note: "wiki server",
      tags: ["web"],
      firstSeenAt: new Date("2026-11-14T14:03:11Z"),
      lastSeenAt: new Date("2026-11-28T14:03:11Z"),
    });
    expect(host.services.map((service) => service._count.observations)).toEqual([3, 3]);
    expect(await prisma.host.count()).toBe(1);
  });

  it("rejects addresses and ports the job did not ask for", async () => {
    const result = await exampleResult();
    const [up] = result.hosts;

    await expect(
      resultsService.ingest(withHosts(result, [{ ...up, ip: "10.0.6.1" }])),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("10.0.6.1") });
    await expect(
      resultsService.ingest(
        withHosts(result, [{ ...up, ports: [{ ...up.ports[0], port: 3306 }] }]),
      ),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("3306") });

    expect(await prisma.scanJobResult.count()).toBe(0);
    expect(await prisma.hostObservation.count()).toBe(0);
  });

  it("rejects a result for an unknown job or another scan's job", async () => {
    const result = await exampleResult();

    await expect(
      resultsService.ingest({ ...result, scan: { ...result.scan, jobId: randomUUID() } }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      resultsService.ingest({ ...result, scan: { ...result.scan, scanId: randomUUID() } }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
