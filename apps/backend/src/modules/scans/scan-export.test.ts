import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SYSTEM_ROLE_KEYS } from "@subsurf/contracts/auth/permissions";
import { SCAN_CSV_COLUMNS } from "@subsurf/contracts/scans/scan-csv";
import { ScanExportDocumentSchema } from "@subsurf/contracts/scans/scan-export.schema";
import type { ObservedHost } from "@subsurf/contracts/workers/worker-result.schema";
import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";

import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestClient, type TestServer } from "~backend/test/http";
import { hostIdOf, ingestHttpx, ingestScan, serviceIdOf, withoutHttp } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

async function exportJson(client: TestClient, scanId: string) {
  const res = await client.get(`/v1/scans/${scanId}/export`);
  expect(res.status).toBe(200);
  return { res, document: ScanExportDocumentSchema.parse(await res.json()) };
}

/** Every page title is something a spreadsheet would run. */
const formulaTitle = (hosts: ObservedHost[]) =>
  hosts.map((host) => ({
    ...host,
    ports: host.ports.map((port) => ({
      ...port,
      http: port.http.map((endpoint) => ({ ...endpoint, title: "=cmd|' /C calc'!A0" })),
    })),
  }));

describe("GET /scans/{id}/export", () => {
  it("lists every address that is not down, decrypted, and the blocks the scan covered", async () => {
    const scanId = await ingestScan();
    const { client } = await signInAs(server, { role: "viewer" });

    const { res, document } = await exportJson(client, scanId);

    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename=scan-[\d-]+\.json$/);
    expect(document.scan).toMatchObject({
      id: scanId,
      status: "queued",
      ports: "21-23,80,443,3306,8000-8100",
      counts: { addresses: 4, up: 1, down: 1, timeout: 1, cancelled: 1, failed: 0, openPorts: 2 },
    });
    // 10.0.5.8 answered `down`: it is covered, so it needs no entry.
    expect(document.coverage).toEqual(["10.0.5.7", "10.0.5.8/31", "10.0.5.200"]);
    expect(document.hosts.map((host) => [host.ip, host.status])).toEqual([
      ["10.0.5.7", "up"],
      ["10.0.5.9", "timeout"],
      ["10.0.5.200", "cancelled"],
    ]);

    const [example] = buildWorkerResult({
      scanId,
      jobId: randomUUID(),
      leaseId: randomUUID(),
    }).hosts;
    const [wiki, timedOut] = document.hosts;
    expect(wiki.ports).toEqual(example.ports);
    expect(wiki.hostnames).toEqual(expect.arrayContaining(example.hostnames));
    expect(timedOut.error).toEqual({ code: "host-timeout", message: expect.any(String) });
    expect(document.edits).toEqual({ hosts: [], services: [] });
  });

  it("carries what users set on the hosts and services, keyed by address", async () => {
    const scanId = await ingestScan();
    const { client } = await signInAs(server, { role: "analyst" });
    const hostId = await hostIdOf("10.0.5.7");
    await client.patch(`/v1/hosts/${hostId}`, {
      body: { note: "Public wiki", tags: ["dmz"], triage: "important" },
    });
    await client.patch(`/v1/hosts/${hostId}/services/${await serviceIdOf("10.0.5.7", 22)}`, {
      body: { productOverride: "OpenSSH (hardened)", triage: "false_positive" },
    });

    const { document } = await exportJson(client, scanId);

    expect(document.edits).toEqual({
      hosts: [{ ip: "10.0.5.7", triage: "important", tags: ["dmz"], note: "Public wiki" }],
      services: [
        {
          ip: "10.0.5.7",
          protocol: "tcp",
          port: 22,
          triage: "false_positive",
          tags: [],
          note: "",
          nameOverride: null,
          productOverride: "OpenSSH (hardened)",
          versionOverride: null,
        },
      ],
    });
    // The observed identity stays what the scan saw.
    expect(document.hosts[0].ports[0].service).toMatchObject({ product: "OpenSSH" });
  });

  it("exports the merged view when several workers observed a host", async () => {
    const scanId = await ingestScan(withoutHttp);
    await ingestHttpx(scanId, "HTTPX only title");
    const { client } = await signInAs(server, { role: "viewer" });

    const { document } = await exportJson(client, scanId);

    const https = document.hosts[0].ports.find((port) => port.port === 443);
    expect(https).toMatchObject({
      service: { name: "https", product: "nginx" },
      http: [{ title: "HTTPX only title" }],
    });
    expect(document.hosts.filter((host) => host.ip === "10.0.5.7")).toHaveLength(1);
  });

  it("writes CSV with a row per endpoint and the covered blocks as down rows", async () => {
    const scanId = await ingestScan(formulaTitle);
    const { client } = await signInAs(server, { role: "viewer" });

    const res = await client.get(`/v1/scans/${scanId}/export?format=csv`);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename=scan-[\d-]+\.csv$/);
    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe(SCAN_CSV_COLUMNS.join(","));
    const cells = lines.slice(1).map((line) => line.split(","));
    expect(cells.map((row) => `${row[0]} ${row[1]} ${row[9]}`)).toEqual([
      "10.0.5.7 up 22",
      "10.0.5.7 up 443",
      "10.0.5.7 up 443",
      "10.0.5.9 timeout ",
      "10.0.5.200 cancelled ",
      "10.0.5.7 down ",
      "10.0.5.8/31 down ",
      "10.0.5.200 down ",
    ]);
    expect(lines[1]).toContain("ssh,OpenSSH,9.6p1");
    expect(lines[2]).toContain("'=cmd|' /C calc'!A0");
  });

  it("answers every system role, and nobody without a session or for an unknown scan", async () => {
    const scanId = await ingestScan();
    for (const role of SYSTEM_ROLE_KEYS) {
      const { client } = await signInAs(server, { role });
      const res = await client.get(`/v1/scans/${scanId}/export?format=csv`);
      expect(res.status, `as ${role}`).toBe(200);
    }
    const { client } = await signInAs(server, { role: "viewer" });
    expect((await client.get(`/v1/scans/${randomUUID()}/export`)).status).toBe(404);
    expect((await client.get(`/v1/scans/${scanId}/export?format=xml`)).status).toBe(400);
    expect((await fetch(`${server.baseUrl}/v1/scans/${scanId}/export`)).status).toBe(401);
  });
});
