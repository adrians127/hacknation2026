import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import {
  ScanExportDocumentSchema,
  type ScanExportDocument,
} from "@subsurf/contracts/scans/scan-export.schema";
import { ImportScanResponseSchema } from "@subsurf/contracts/scans/scan-import.schema";
import {
  ScanDetailSchema,
  ScanHostListResponseSchema,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { ObservedHost } from "@subsurf/contracts/workers/worker-result.schema";
import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";

import { prisma } from "~backend/lib/prisma";
import { resultsService } from "~backend/modules/results/results.service";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestClient, type TestServer } from "~backend/test/http";
import { databaseHost, hostIdOf, ingestScan, serviceIdOf } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const withDatabaseHost = (hosts: ObservedHost[]) => [...hosts, databaseHost(hosts)];
const exampleResult = () =>
  buildWorkerResult({ scanId: randomUUID(), jobId: randomUUID(), leaseId: randomUUID() });
const exampleHosts = () => exampleResult().hosts;

/** A scan export nobody exported: the given hosts as a scan of 2026-11-10. */
function documentOf(
  hosts: ObservedHost[],
  overrides: Partial<Omit<ScanExportDocument, "scan">> & { scan?: Partial<ScanExportDocument["scan"]> } = {},
): ScanExportDocument {
  const { scan, ...rest } = overrides;
  return {
    format: "subsurf-scan",
    version: 1,
    exportedAt: "2026-11-22T00:00:00.000Z",
    coverage: [],
    hosts,
    edits: { hosts: [], services: [] },
    ...rest,
    scan: {
      id: randomUUID(),
      name: "",
      status: "completed",
      createdAt: "2026-11-10T01:00:00.000Z",
      startedAt: "2026-11-10T01:00:00.000Z",
      finishedAt: "2026-11-10T01:30:00.000Z",
      ports: "22,443",
      maxRate: 100,
      counts: { addresses: 0, up: 0, down: 0, timeout: 0, cancelled: 0, failed: 0, openPorts: 0 },
      ...scan,
    },
  };
}

async function exportOf(client: TestClient, scanId: string): Promise<ScanExportDocument> {
  const res = await client.get(`/v1/scans/${scanId}/export`);
  expect(res.status).toBe(200);
  return ScanExportDocumentSchema.parse(await res.json());
}

async function importFile(client: TestClient, body: unknown, query = "") {
  const res = await client.post(`/v1/scans/import${query}`, { body });
  expect(res.status).toBe(201);
  return ImportScanResponseSchema.parse(await res.json());
}

async function errorOf(res: Response) {
  return ErrorResponseSchema.parse(await res.json()).error;
}

describe("POST /scans/import", () => {
  it("imports an exported scan so that it shows no change against the original", async () => {
    const original = await ingestScan(withDatabaseHost);
    const { client } = await signInAs(server, { role: "editor" });
    const file = await exportOf(client, original);

    const imported = await importFile(client, file, "?name=lab-run.json");

    expect(imported).toMatchObject({
      inputFormat: "subsurf-scan",
      jobs: 1,
      hosts: { up: 2, down: 1, timeout: 1, cancelled: 1, failed: 0 },
      openPorts: 3,
      edits: null,
      warningCount: 0,
    });
    const detail = ScanDetailSchema.parse(
      await (await client.get(`/v1/scans/${imported.scanId}?base=${original}`)).json(),
    );
    expect(detail).toMatchObject({
      name: "lab-run.json",
      origin: "imported",
      status: "completed",
      jobs: { queued: 0, leased: 0, completed: 1, failed: 0, stopped: 0 },
      baseScan: { id: original },
      changes: {
        hosts: { new: 0, gone: 0, changed: 0, unknown: 0 },
        services: { new: 0, gone: 0, changed: 0 },
      },
      coverage: { both: 3, onlyBase: 0, onlyCurrent: 0 },
    });

    const again = await exportOf(client, imported.scanId);
    expect(again.hosts).toEqual(file.hosts);
    expect(again.coverage).toEqual(file.coverage);
    expect(again.scan.counts).toEqual(file.scan.counts);
    expect(again.scan.ports).toBe(file.scan.ports);
  });

  it("writes the covered addresses a file leaves out as down", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const [wiki] = exampleHosts();

    const imported = await importFile(client, documentOf([wiki], { coverage: ["10.0.5.0/29"] }));

    expect(imported.hosts).toEqual({ up: 1, down: 7, timeout: 0, cancelled: 0, failed: 0 });
    const down = await prisma.hostObservation.findMany({
      where: { scanId: imported.scanId, status: "down" },
      orderBy: { ipNumber: "asc" },
      select: { ip: true },
    });
    expect(down.map((row) => row.ip)).toEqual([
      "10.0.5.0",
      "10.0.5.1",
      "10.0.5.2",
      "10.0.5.3",
      "10.0.5.4",
      "10.0.5.5",
      "10.0.5.6",
    ]);
  });

  it("replays worker results with their worker and timing", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const nmap = exampleResult();
    const httpx = exampleResult();
    httpx.scan.scanId = nmap.scan.scanId;
    httpx.scan.worker = { id: "httpx-worker", version: "0.1.0", nmapVersion: null };
    httpx.hosts = [httpx.hosts[0]];

    const imported = await importFile(client, [nmap, httpx]);

    expect(imported).toMatchObject({
      inputFormat: "worker-results",
      jobs: 2,
      hosts: { up: 1, down: 1, timeout: 1, cancelled: 1, failed: 0 },
      openPorts: 2,
    });
    expect(imported.placedAt).toBe("2026-11-21T14:00:02.000Z");
    const results = await prisma.scanJobResult.findMany({
      where: { scanId: imported.scanId },
      orderBy: { workerId: "asc" },
      select: { workerId: true, durationMs: true, leaseId: true },
    });
    expect(results.map((row) => row.workerId)).toEqual(["httpx-worker", "nmap-worker-1"]);
    expect(results.map((row) => row.leaseId)).not.toContain(nmap.scan.leaseId);
    // The example's job hit its deadline.
    const scan = await prisma.scan.findUniqueOrThrow({ where: { id: imported.scanId } });
    expect(scan).toMatchObject({ status: "stopped", origin: "imported" });
    const page = ScanHostListResponseSchema.parse(
      await (await client.get(`/v1/scans/${imported.scanId}/hosts`)).json(),
    );
    expect(page.items.map((host) => host.ip)).toEqual(["10.0.5.7"]);
  });

  it("places the scan by when the file says it ran, so it can become a base scan", async () => {
    const newer = await ingestScan();
    const { client } = await signInAs(server, { role: "editor" });
    const [wiki, ...rest] = exampleHosts();

    // Run on 2026-11-10: older than the scan above, and without the wiki's SSH port.
    const imported = await importFile(
      client,
      documentOf([{ ...wiki, ports: wiki.ports.filter((port) => port.port !== 22) }, ...rest]),
    );

    expect(imported.placedAt).toBe("2026-11-10T01:00:00.000Z");
    const detail = ScanDetailSchema.parse(await (await client.get(`/v1/scans/${newer}`)).json());
    expect(detail).toMatchObject({
      baseScan: { id: imported.scanId },
      changes: { hosts: { changed: 1 }, services: { new: 1 } },
    });
  });

  it("never places a scan in the future", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const before = Date.now();

    const imported = await importFile(
      client,
      documentOf(exampleHosts(), { scan: { createdAt: "2099-01-01T00:00:00.000Z" } }),
    );

    expect(Date.parse(imported.placedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(imported.placedAt)).toBeLessThanOrEqual(Date.now());
  });

  it("imports the same content once", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const file = documentOf(exampleHosts());
    const first = await importFile(client, file);

    // Another export of the same scan: only its export time, id and edits differ.
    const res = await client.post("/v1/scans/import", {
      body: { ...file, exportedAt: "2026-11-23T00:00:00.000Z", scan: { ...file.scan, id: randomUUID() } },
    });

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toMatchObject({
      code: "SCAN_ALREADY_IMPORTED",
      details: { scanId: first.scanId },
    });
    expect(await prisma.scan.count()).toBe(1);
  });

  it("leaves nothing behind when the import fails midway", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const [wiki] = exampleHosts();
    const real = resultsService.ingestWithin.bind(resultsService);
    let calls = 0;
    vi.spyOn(resultsService, "ingestWithin").mockImplementation((tx, result, part) => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error("disk full")) : real(tx, result, part);
    });

    // Two /16s: two jobs, and the second one fails.
    const res = await client.post("/v1/scans/import", {
      body: documentOf([wiki, { ...wiki, ip: "10.1.5.7" }]),
    });

    expect(res.status).toBe(500);
    expect(calls).toBe(2);
    expect(await prisma.scan.count()).toBe(0);
    expect(await prisma.scanJob.count()).toBe(0);
    expect(await prisma.host.count()).toBe(0);
    expect(await prisma.service.count()).toBe(0);
  });

  it("widens the recorded port list by the ports the file reports open", async () => {
    const { client } = await signInAs(server, { role: "editor" });

    const imported = await importFile(client, documentOf(exampleHosts(), { scan: { ports: "22,8000-8100" } }));

    const scan = await prisma.scan.findUniqueOrThrow({ where: { id: imported.scanId } });
    expect(scan.ports).toBe("22,443,8000-8100");
  });

  it("rejects files it cannot read, saying what is wrong", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const issuesOf = async (body: unknown) => {
      const res = await client.post("/v1/scans/import", { body });
      expect(res.status).toBe(400);
      const error = await errorOf(res);
      expect(error.code).toBe("SCAN_IMPORT_INVALID");
      return error.details;
    };
    const [wiki] = exampleHosts();
    const other = exampleResult();

    expect(await issuesOf({ hello: "world" })).toMatchObject({ issues: [{ code: "unknown_format" }] });
    expect(await issuesOf({ ...documentOf([wiki]), version: 2 })).toMatchObject({
      issues: [{ code: "unsupported_version", detail: "2" }],
    });
    expect(await issuesOf(documentOf([wiki, wiki]))).toMatchObject({
      issues: [{ code: "duplicate_address", detail: "10.0.5.7" }],
    });
    expect(await issuesOf(documentOf([]))).toMatchObject({ issues: [{ code: "nothing_to_import" }] });
    expect(await issuesOf([exampleResult(), other])).toMatchObject({
      issues: [{ code: "multiple_scans" }],
    });
    expect(await issuesOf({ ...other, hosts: [{ ...wiki, ip: "not-an-address" }] })).toMatchObject({
      issues: [{ code: "invalid_result", position: 0 }],
    });
    expect(await prisma.scan.count()).toBe(0);
  });

  it("lets only roles that may create scans import, and needs hosts:update for the edits", async () => {
    for (const role of ["viewer", "analyst"] as const) {
      const { client } = await signInAs(server, { role });
      const res = await client.post("/v1/scans/import", { body: documentOf(exampleHosts()) });
      expect(res.status, `as ${role}`).toBe(403);
    }
    const importer = await prisma.role.create({
      data: { name: "Importer", permissions: ["scans:read", "scans:create"] },
    });
    const { client } = await signInAs(server, { roleId: importer.id });

    const withEdits = await client.post("/v1/scans/import?edits=fill", {
      body: documentOf(exampleHosts()),
    });
    expect(withEdits.status).toBe(403);
    expect(await prisma.scan.count()).toBe(0);
    await importFile(client, documentOf(exampleHosts()));

    expect((await fetch(`${server.baseUrl}/v1/scans/import`, { method: "POST" })).status).toBe(401);
  });
});

describe("POST /scans/import?edits=fill", () => {
  const edits = {
    hosts: [{ ip: "10.0.5.7", triage: "important" as const, tags: ["dmz", "wiki"], note: "From the lab" }],
    services: [
      {
        ip: "10.0.5.7",
        protocol: "tcp" as const,
        port: 22,
        triage: "false_positive" as const,
        tags: [],
        note: "",
        nameOverride: null,
        productOverride: "OpenSSH (hardened)",
        versionOverride: null,
      },
      {
        ip: "10.0.5.7",
        protocol: "tcp" as const,
        port: 9999,
        triage: "reviewed" as const,
        tags: [],
        note: "",
        nameOverride: null,
        productOverride: null,
        versionOverride: null,
      },
    ],
  };

  it("applies the file's edits to hosts and services nobody edited", async () => {
    const { client } = await signInAs(server, { role: "editor" });

    const imported = await importFile(client, documentOf(exampleHosts(), { edits }), "?edits=fill");

    // The service on 9999 is not part of the scan.
    expect(imported.edits).toEqual({ applied: 2, kept: 0, missing: 1 });
    const file = await exportOf(client, imported.scanId);
    expect(file.edits).toEqual({ hosts: edits.hosts, services: [edits.services[0]] });
  });

  it("ignores the edits unless asked", async () => {
    const { client } = await signInAs(server, { role: "editor" });

    const imported = await importFile(client, documentOf(exampleHosts(), { edits }));

    expect(imported.edits).toBeNull();
    expect((await exportOf(client, imported.scanId)).edits).toEqual({ hosts: [], services: [] });
  });

  it("keeps what an analyst already set, and later scans keep it too", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "editor" });
    const hostId = await hostIdOf("10.0.5.7");
    await client.patch(`/v1/hosts/${hostId}`, {
      body: { note: "Ours", tags: ["prod"], triage: "reviewed" },
    });
    await client.patch(`/v1/hosts/${hostId}/services/${await serviceIdOf("10.0.5.7", 22)}`, {
      body: { productOverride: "Dropbear" },
    });

    const imported = await importFile(client, documentOf(exampleHosts(), { edits }), "?edits=fill");

    // The host only gains tags; the service gains its triage but keeps its correction.
    expect(imported.edits).toEqual({ applied: 2, kept: 0, missing: 1 });
    const expected = {
      hosts: [{ ip: "10.0.5.7", triage: "reviewed", tags: ["prod", "dmz", "wiki"], note: "Ours" }],
      services: [{ port: 22, triage: "false_positive", productOverride: "Dropbear" }],
    };
    expect((await exportOf(client, imported.scanId)).edits).toMatchObject(expected);

    const later = await ingestScan();
    expect((await exportOf(client, later)).edits).toMatchObject(expected);
  });
});
