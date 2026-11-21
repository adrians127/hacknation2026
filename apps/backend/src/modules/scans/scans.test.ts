import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  ScanDetailSchema,
  ScanHostDetailSchema,
  ScanHostListResponseSchema,
} from "@subsurf/contracts/scans/scan-results.schema";
import { ScanListResponseSchema } from "@subsurf/contracts/scans/scans.schema";
import type { ObservedHost } from "@subsurf/contracts/workers/worker-result.schema";

import { signInAs } from "~backend/test/auth";
import { startTestServer, TestClient, type TestServer } from "~backend/test/http";
import { databaseHost, hostIdOf, ingestScan } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const withDatabaseHost = (hosts: ObservedHost[]) => [...hosts, databaseHost(hosts)];

/**
 * The second scan: the wiki's SSH is upgraded and it opens 8080, the database host goes down
 * and 10.0.5.8 comes up with SSH.
 */
function secondScan(hosts: ObservedHost[]): ObservedHost[] {
  const [wiki, down, ...rest] = hosts;
  const [ssh, https] = wiki.ports;
  if (!ssh.service) throw new Error("The example's SSH port has a service");
  const upgraded = { ...ssh, service: { ...ssh.service, version: "9.7p1" } };
  return [
    { ...wiki, ports: [upgraded, https, { ...ssh, port: 8080, service: null, banner: null }] },
    { ...wiki, ip: down.ip, hostnames: [], ports: [ssh] },
    ...rest,
    { ...databaseHost(hosts), status: "down", reason: "no-response", hostnames: [], ports: [] },
  ];
}

async function twoScans() {
  const first = await ingestScan(withDatabaseHost);
  const second = await ingestScan(secondScan);
  return { first, second };
}

async function getJson(client: TestClient, path: string): Promise<unknown> {
  const res = await client.get(path);
  expect(res.status).toBe(200);
  return res.json();
}

describe("GET /scans", () => {
  it("lists scans newest first with what their workers found", async () => {
    const { first, second } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });

    const { items } = ScanListResponseSchema.parse(await getJson(client, "/v1/scans"));

    expect(items.map((scan) => scan.id)).toEqual([second, first]);
    expect(items[1]).toMatchObject({
      hosts: { up: 2, down: 1, timeout: 1, cancelled: 1, failed: 0 },
      openPorts: 3,
      addressCount: 256,
    });
  });
});

describe("GET /scans/{id}", () => {
  it("counts the changes since the previous scan, and none for the first scan", async () => {
    const { first, second } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });

    const latest = ScanDetailSchema.parse(await getJson(client, `/v1/scans/${second}`));
    const earliest = ScanDetailSchema.parse(await getJson(client, `/v1/scans/${first}`));

    expect(latest).toMatchObject({
      baseScan: { id: first },
      changes: {
        hosts: { new: 1, gone: 1, changed: 1, unknown: 0 },
        services: { new: 2, gone: 1, changed: 1 },
      },
      jobs: { queued: 1, leased: 0, completed: 0, failed: 0, stopped: 0 },
      ports: "21-23,80,443,3306,8000-8100",
    });
    expect(earliest).toMatchObject({ baseScan: null, changes: null });
  });

  it("answers 404 for an unknown scan", async () => {
    const { client } = await signInAs(server, { role: "viewer" });

    expect((await client.get(`/v1/scans/${randomUUID()}`)).status).toBe(404);
  });
});

describe("GET /scans/{id}/hosts", () => {
  it("lists the hosts of a scan with host and service changes", async () => {
    const { second } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });

    const { items, total } = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${second}/hosts`),
    );

    expect(total).toBe(3);
    expect(items.map((host) => [host.ip, host.status, host.change])).toEqual([
      ["10.0.5.7", "up", "changed"],
      ["10.0.5.8", "up", "new"],
      ["10.0.5.20", "down", "gone"],
    ]);
    const [wiki, , database] = items;
    expect(wiki.services.map((service) => [service.port, service.change, service.observed.version])).toEqual([
      [22, "changed", "9.7p1"],
      [443, "unchanged", "1.24.0"],
      [8080, "new", null],
    ]);
    expect(wiki.services[1].http.map((endpoint) => endpoint.title)).toEqual(["Wiki – login", null]);
    // A host that is gone shows what it had when it was last up.
    expect(database).toMatchObject({
      hostnames: ["db01.example.org"],
      services: [{ port: 3306, change: "gone", observed: { product: "MySQL" } }],
    });
    // The list never decrypts: headers, cookies and certificates are in the host detail.
    expect(JSON.stringify(items)).not.toContain("PHPSESSID");
  });

  it("filters by change, search (IP, hostname, title, port, product, tag) and pages", async () => {
    const { second } = await twoScans();
    const { client } = await signInAs(server, { role: "editor" });
    await client.patch(`/v1/hosts/${await hostIdOf("10.0.5.8")}`, { body: { tags: ["lab"] } });
    const ips = async (query: string) =>
      ScanHostListResponseSchema.parse(
        await getJson(client, `/v1/scans/${second}/hosts${query}`),
      ).items.map((host) => host.ip);

    expect(await ips("?change=gone")).toEqual(["10.0.5.20"]);
    expect(await ips("?change=any")).toEqual(["10.0.5.7", "10.0.5.8", "10.0.5.20"]);
    expect(await ips("?change=unknown")).toEqual([]);
    expect(await ips("?q=10.0.5.2")).toEqual(["10.0.5.20"]);
    expect(await ips("?q=WIKI")).toEqual(["10.0.5.7"]);
    expect(await ips(`?q=${encodeURIComponent("login")}`)).toEqual(["10.0.5.7"]);
    expect(await ips("?q=3306")).toEqual(["10.0.5.20"]);
    expect(await ips("?q=mysql")).toEqual(["10.0.5.20"]);
    expect(await ips("?q=lab")).toEqual(["10.0.5.8"]);
    expect(await ips("?q=100%25")).toEqual([]);

    const page = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${second}/hosts?page=2&pageSize=1`),
    );
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 1 });
    expect(page.items.map((host) => host.ip)).toEqual(["10.0.5.8"]);
    expect((await client.get(`/v1/scans/${second}/hosts?change=everything`)).status).toBe(400);
  });
});

describe("GET /scans/{id}/hosts/{hostId}", () => {
  it("returns the host as each scan saw it, with decrypted details and history", async () => {
    const { first, second } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });
    const wiki = await hostIdOf("10.0.5.7");

    const before = ScanHostDetailSchema.parse(await getJson(client, `/v1/scans/${first}/hosts/${wiki}`));
    const after = ScanHostDetailSchema.parse(await getJson(client, `/v1/scans/${second}/hosts/${wiki}`));

    expect(before).toMatchObject({ change: null, services: [{ port: 22, observed: { version: "9.6p1" } }, { port: 443 }] });
    expect(after.services[0]).toMatchObject({ port: 22, change: "changed", observed: { version: "9.7p1" } });
    const [vhost] = after.services[1].http;
    expect(vhost.headers).toContainEqual({ name: "x-powered-by", value: "PHP/8.1.2" });
    expect(vhost.cookies.map((cookie) => cookie.name)).toEqual(["PHPSESSID"]);
    expect(vhost.tls?.cert.subjectCn).toBe("wiki.example.org");
    expect(after.services[0]).toMatchObject({ banner: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13" });
    expect(after.history.map((entry) => entry.status)).toEqual(["up", "up"]);
  });

  it("answers 404 for a host the scan did not see", async () => {
    const { first } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });

    // 10.0.5.8 was down in the first scan and is up only in the second.
    expect((await client.get(`/v1/scans/${first}/hosts/${await hostIdOf("10.0.5.8")}`)).status).toBe(404);
    expect((await client.get(`/v1/scans/${first}/hosts/${randomUUID()}`)).status).toBe(404);
  });
});

describe("scans RBAC", () => {
  it("needs a session, and every system role can read scans", async () => {
    const { second } = await twoScans();

    expect((await new TestClient(server.baseUrl).get("/v1/scans")).status).toBe(401);
    for (const role of ["admin", "editor", "analyst", "viewer"] as const) {
      const { client } = await signInAs(server, { role });
      expect((await client.get(`/v1/scans/${second}/hosts`)).status).toBe(200);
    }
  });
});
