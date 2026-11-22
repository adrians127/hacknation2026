import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_TAGS } from "@subsurf/contracts/common/common.schema";
import {
  ScanDetailSchema,
  ScanHostDetailSchema,
  ScanHostListResponseSchema,
  TagScanHostsResponseSchema,
  type TagScanHostsBody,
} from "@subsurf/contracts/scans/scan-results.schema";
import { ScanChangesResponseSchema } from "@subsurf/contracts/scans/scan-changes.schema";
import { ScanListResponseSchema } from "@subsurf/contracts/scans/scans.schema";
import type { ObservedHost } from "@subsurf/contracts/workers/worker-result.schema";
import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";

import { prisma } from "~backend/lib/prisma";
import { resultsService } from "~backend/modules/results/results.service";
import { signInAs } from "~backend/test/auth";
import { startTestServer, TestClient, type TestServer } from "~backend/test/http";
import {
  databaseHost,
  hostIdOf,
  ingestHttpx,
  ingestScan,
  serviceIdOf,
  withoutHttp,
} from "~backend/test/scans";

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

/** The example (10.0.5.8 down) with the database host down too. */
function databaseDown(hosts: ObservedHost[]): ObservedHost[] {
  return [
    ...hosts,
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

const masscanOnly = (hosts: ObservedHost[]) => hosts.map((host) => ({
  ...host,
  ports: host.ports.filter((port) => port.port === 443).map((port) => ({
    ...port,
    service: null,
    banner: null,
    scripts: [],
    http: [],
  })),
}));

describe("GET /scans", () => {
  it("combines TLS-only observations with Nmap service data and no HTTP endpoint", async () => {
    const scanId = await ingestScan(withoutHttp);
    const job = await prisma.scanJob.findFirstOrThrow({ where: { scanId }, select: { id: true } });
    const tlsx = buildWorkerResult({ scanId, jobId: job.id, leaseId: randomUUID() });
    const wiki = tlsx.hosts[0];
    const port = wiki.ports.find((candidate) => candidate.port === 443)!;
    tlsx.scan.worker = { id: "tlsx-worker", version: "0.1.0", nmapVersion: null };
    tlsx.hosts = [{ ...wiki, ports: [{ ...port, service: null, http: [], tls: [{
      vhost: "wiki.example.org", version: "tls13", cipher: "TLS_AES_128_GCM_SHA256",
      alpn: null, cert: { subjectCn: "wiki.example.org", san: ["wiki.example.org"],
        issuer: "Local CA", notBefore: "2026-01-01T00:00:00Z",
        notAfter: "2027-01-01T00:00:00Z", serial: "123", sha256: "a".repeat(64),
        selfSigned: null, keyAlgorithm: null, keyBits: null },
    }] }] }];
    await resultsService.ingest(tlsx);
    const { client } = await signInAs(server, { role: "viewer" });
    const detail = ScanHostDetailSchema.parse(
      await getJson(client, `/v1/scans/${scanId}/hosts/${await hostIdOf("10.0.5.7")}`),
    );
    expect(detail.services.find((service) => service.port === 443)).toMatchObject({
      observed: { product: "nginx" }, http: [],
      tls: [{ vhost: "wiki.example.org", cert: { sha256: "a".repeat(64) } }],
    });
  });

  it("keeps Nmap service detection with Masscan when httpx is absent", async () => {
    const scanId = await ingestScan(masscanOnly, "masscan-worker");
    const job = await prisma.scanJob.findFirstOrThrow({ where: { scanId }, select: { id: true } });
    const nmap = buildWorkerResult({ scanId, jobId: job.id, leaseId: randomUUID() });
    nmap.hosts = [{
      ...nmap.hosts[0],
      ports: nmap.hosts[0].ports.filter((port) => port.port === 443)
        .map((port) => ({ ...port, http: [] })),
    }];
    await resultsService.ingest(nmap);
    const { client } = await signInAs(server, { role: "viewer" });

    const page = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${scanId}/hosts`),
    );
    expect(page.items[0].services).toMatchObject([
      { port: 443, observed: { product: "nginx" }, http: [] },
    ]);
    const { items } = ScanListResponseSchema.parse(await getJson(client, "/v1/scans"));
    expect(items[0].openPorts).toBe(1);
  });

  it("combines Nmap service data with httpx responses and searches their titles", async () => {
    const scanId = await ingestScan(withoutHttp);
    await ingestHttpx(scanId, "HTTPX only title");
    const { client } = await signInAs(server, { role: "viewer" });

    const page = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${scanId}/hosts?q=HTTPX only title`),
    );
    expect(page.total).toBe(1);
    expect(page.items[0].services.find((service) => service.port === 443)).toMatchObject({
      observed: { name: "https", product: "nginx" },
      http: [{ title: "HTTPX only title" }],
    });
    const detail = ScanHostDetailSchema.parse(
      await getJson(client, `/v1/scans/${scanId}/hosts/${await hostIdOf("10.0.5.7")}`),
    );
    expect(detail.services.find((service) => service.port === 443)).toMatchObject({
      observed: { product: "nginx" },
      http: [{ title: "HTTPX only title" }],
    });
    const { items } = ScanListResponseSchema.parse(await getJson(client, "/v1/scans"));
    expect(items[0].openPorts).toBe(2);
  });

  it("shows Masscan plus httpx without Nmap and detects HTTP changes", async () => {
    const first = await ingestScan(masscanOnly, "masscan-worker");
    await ingestHttpx(first, "Before title");
    const second = await ingestScan(masscanOnly, "masscan-worker");
    await ingestHttpx(second, "After title");
    const { client } = await signInAs(server, { role: "viewer" });

    const detail = ScanHostDetailSchema.parse(
      await getJson(client, `/v1/scans/${second}/hosts/${await hostIdOf("10.0.5.7")}`),
    );
    expect(detail.services).toHaveLength(1);
    expect(detail.services[0]).toMatchObject({
      port: 443,
      change: "changed",
      observed: { name: null, product: null, version: null },
      http: [{ title: "After title" }],
      before: { http: [{ title: "Before title" }] },
    });
    expect(detail.services[0].fieldChanges).toContainEqual(expect.objectContaining({
      field: "http.title",
      before: "Before title",
      after: "After title",
    }));
    const scan = ScanDetailSchema.parse(await getJson(client, `/v1/scans/${second}`));
    expect(scan.changes?.services.changed).toBe(1);
    expect(scan.openPorts).toBe(1);
  });

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

  it("counts a host once when two worker results observe it in one scan", async () => {
    const scanId = await ingestScan();
    const job = await prisma.scanJob.findFirstOrThrow({ where: { scanId }, select: { id: true } });
    const second = buildWorkerResult({ scanId, jobId: job.id, leaseId: randomUUID() });
    second.hosts[0] = {
      ...second.hosts[0],
      status: "down",
      reason: "no-response",
      ports: [],
    };
    await resultsService.ingest(second);
    const { client } = await signInAs(server, { role: "viewer" });

    const { items } = ScanListResponseSchema.parse(await getJson(client, "/v1/scans"));
    expect(items[0]).toMatchObject({
      hosts: { up: 1, down: 1, timeout: 1, cancelled: 1, failed: 0 },
      openPorts: 2,
    });
    const page = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${scanId}/hosts`),
    );
    expect(page.total).toBe(1);
    expect(page.items.map((host) => host.ip)).toEqual(["10.0.5.7"]);
    const detail = ScanHostDetailSchema.parse(
      await getJson(client, `/v1/scans/${scanId}/hosts/${await hostIdOf("10.0.5.7")}`),
    );
    expect(detail.status).toBe("up");
    expect(detail.history).toHaveLength(1);
  });

  it("searches the selected observation, not a superseded worker result", async () => {
    const scanId = await ingestScan();
    const job = await prisma.scanJob.findFirstOrThrow({ where: { scanId }, select: { id: true } });
    const second = buildWorkerResult({ scanId, jobId: job.id, leaseId: randomUUID() });
    second.hosts[0] = {
      ...second.hosts[0],
      observedAt: "2026-11-22T14:03:11Z",
      ports: [],
    };
    await resultsService.ingest(second);
    const { client } = await signInAs(server, { role: "viewer" });

    const page = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${scanId}/hosts`),
    );
    expect(page.items[0].services).toEqual([]);
    const byOldPort = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${scanId}/hosts?q=22`),
    );
    expect(byOldPort.total).toBe(0);
    const byOldTitle = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${scanId}/hosts?q=login`),
    );
    expect(byOldTitle.total).toBe(0);
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
    expect(earliest).toMatchObject({ baseScan: null, changes: null, coverage: null });
    expect(latest.coverage).toEqual({ both: 3, onlyBase: 0, onlyCurrent: 0 });
  });

  it("compares with an explicitly chosen older scan", async () => {
    const { first, second } = await twoScans();
    const third = await ingestScan(secondScan);
    const { client } = await signInAs(server, { role: "viewer" });

    const byDefault = ScanDetailSchema.parse(await getJson(client, `/v1/scans/${third}`));
    const withFirst = ScanDetailSchema.parse(await getJson(client, `/v1/scans/${third}?base=${first}`));

    expect(byDefault).toMatchObject({
      baseScan: { id: second },
      changes: { hosts: { new: 0, gone: 0, changed: 0, unknown: 0 } },
    });
    expect(withFirst).toMatchObject({
      baseScan: { id: first },
      changes: {
        hosts: { new: 1, gone: 1, changed: 1, unknown: 0 },
        services: { new: 2, gone: 1, changed: 1 },
      },
    });
  });

  it("rejects a base scan that is not older, and answers 404 for an unknown one", async () => {
    const { first, second } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });

    const newer = await client.get(`/v1/scans/${first}?base=${second}`);
    expect(newer.status).toBe(400);
    expect(await newer.json()).toMatchObject({ error: { code: "BASE_SCAN_NOT_OLDER" } });
    expect((await client.get(`/v1/scans/${first}?base=${first}`)).status).toBe(400);
    expect((await client.get(`/v1/scans/${first}?base=not-a-uuid`)).status).toBe(400);
    expect((await client.get(`/v1/scans/${second}?base=${randomUUID()}`)).status).toBe(404);
  });

  it("marks a host unknown, not new, when the base scan got no answer from it", async () => {
    await ingestScan();
    const second = await ingestScan((hosts) => {
      const [wiki] = hosts;
      // 10.0.5.9 timed out in the first scan, which has no observation of 10.0.5.30.
      return [
        ...hosts.filter((host) => host.ip !== "10.0.5.9"),
        { ...wiki, ip: "10.0.5.9", hostnames: [] },
        { ...wiki, ip: "10.0.5.30", hostnames: [] },
      ];
    });
    const { client } = await signInAs(server, { role: "viewer" });

    const detail = ScanDetailSchema.parse(await getJson(client, `/v1/scans/${second}`));
    const { items } = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${second}/hosts?change=unknown`),
    );

    expect(detail.changes?.hosts).toEqual({ new: 0, gone: 0, changed: 0, unknown: 2 });
    expect(detail.coverage).toEqual({ both: 2, onlyBase: 0, onlyCurrent: 2 });
    expect(items.map((host) => [host.ip, host.status, host.baseStatus])).toEqual([
      ["10.0.5.9", "up", "timeout"],
      ["10.0.5.30", "up", null],
    ]);
    expect(items[0].services.map((service) => [service.change, service.before])).toEqual([
      ["unknown", null],
      ["unknown", null],
    ]);
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
    expect(items.map((host) => host.baseStatus)).toEqual(["up", "down", "up"]);
    const [wiki, , database] = items;
    expect(
      wiki.services.map((service) => [
        service.port,
        service.change,
        service.observed.version,
        service.before?.observed.version ?? null,
      ]),
    ).toEqual([
      [22, "changed", "9.7p1", "9.6p1"],
      [443, "unchanged", "1.24.0", "1.24.0"],
      [8080, "new", null, null],
    ]);
    expect(wiki.services[1].before?.http.map((endpoint) => endpoint.title)).toEqual([
      "Wiki – login",
      null,
    ]);
    expect(wiki.services[1].http.map((endpoint) => endpoint.title)).toEqual(["Wiki – login", null]);
    // A host that is gone shows what it had when it was last up.
    expect(database).toMatchObject({
      hostnames: ["db01.example.org"],
      services: [
        {
          port: 3306,
          change: "gone",
          observed: { product: "MySQL" },
          before: { observed: { product: "MySQL" } },
        },
      ],
    });
    // The list never decrypts: headers, cookies and certificates are in the host detail.
    expect(JSON.stringify(items)).not.toContain("PHPSESSID");
  });

  it("reports each host's lifecycle as of the viewed scan", async () => {
    const { first, second } = await twoScans();
    // 10.0.5.8 goes down again and comes back; the database host stays down.
    await ingestScan(databaseDown);
    const fourth = await ingestScan(secondScan);
    const { client } = await signInAs(server, { role: "viewer" });
    const lifecycles = async (scanId: string, query = "") =>
      Object.fromEntries(
        ScanHostListResponseSchema.parse(
          await getJson(client, `/v1/scans/${scanId}/hosts${query}`),
        ).items.map((host) => [host.ip, [host.change, host.lifecycle]]),
      );

    expect(await lifecycles(fourth, `?base=${first}`)).toEqual({
      "10.0.5.7": ["changed", { state: "active", misses: 0, flips: 0 }],
      "10.0.5.8": ["new", { state: "unstable", misses: 0, flips: 3 }],
      "10.0.5.20": ["gone", { state: "inactive", misses: 3, flips: 1 }],
    });
    // As of the second scan, later scans do not count yet.
    expect((await lifecycles(second))["10.0.5.20"]).toEqual([
      "gone",
      { state: "missing", misses: 1, flips: 1 },
    ]);
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
    await prisma.service.update({
      where: { id: await serviceIdOf("10.0.5.7", 22) },
      data: { productOverride: "Bastion SSH" },
    });
    expect(await ips("?q=bastion")).toEqual(["10.0.5.7"]);
    expect(await ips("?q=ssh&triage=unreviewed")).toEqual(["10.0.5.7", "10.0.5.8"]);

    const page = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${second}/hosts?page=2&pageSize=1`),
    );
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 1 });
    expect(page.items.map((host) => host.ip)).toEqual(["10.0.5.8"]);
    expect((await client.get(`/v1/scans/${second}/hosts?change=everything`)).status).toBe(400);
  });

  it("searches a scan with more observations than Postgres takes bind parameters", async () => {
    const { second } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });
    // 70,000 more addresses that did not answer (10.1.0.0 onwards).
    await prisma.$executeRaw`
      INSERT INTO "HostObservation" (id, "scanId", "resultId", ip, "ipNumber", status)
      SELECT gen_random_uuid(), r."scanId", r.id,
             concat_ws('.', 10, 1 + n / 65536, (n / 256) % 256, n % 256), 167837696 + n,
             'down'::"HostObservationStatus"
      FROM "ScanJobResult" r CROSS JOIN generate_series(0, 69999) AS n
      WHERE r."scanId" = ${second}::uuid
    `;
    const ips = async (query: string) =>
      ScanHostListResponseSchema.parse(
        await getJson(client, `/v1/scans/${second}/hosts${query}`),
      ).items.map((host) => host.ip);

    expect(await ips("?q=mysql")).toEqual(["10.0.5.20"]);
    expect(await ips("?q=WIKI")).toEqual(["10.0.5.7"]);
    expect(await ips("?q=login&triage=unreviewed")).toEqual(["10.0.5.7"]);
  }, 30_000);
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
    // Side by side: the base scan's decrypted observation, and what differs from it.
    expect(after.services[0].fieldChanges).toEqual([
      { field: "service.version", endpoint: null, key: null, before: "9.6p1", after: "9.7p1" },
    ]);
    expect(after.services[0].before).toMatchObject({ observed: { version: "9.6p1" } });
    expect(after.services[1].fieldChanges).toEqual([]);
    expect(after.services[1].before?.http[0].cookies.map((cookie) => cookie.name)).toEqual([
      "PHPSESSID",
    ]);
    expect(after.services[2]).toMatchObject({ port: 8080, change: "new", before: null, fieldChanges: [] });
    expect(after.fieldChanges).toEqual([]);
    expect(before.services.every((service) => service.before === null)).toBe(true);
  });

  it("compares the host with an explicitly chosen base scan", async () => {
    const { first, second } = await twoScans();
    const third = await ingestScan(secondScan);
    const { client } = await signInAs(server, { role: "viewer" });
    const wiki = await hostIdOf("10.0.5.7");

    const byDefault = ScanHostDetailSchema.parse(await getJson(client, `/v1/scans/${third}/hosts/${wiki}`));
    const withFirst = ScanHostDetailSchema.parse(
      await getJson(client, `/v1/scans/${third}/hosts/${wiki}?base=${first}`),
    );

    expect(byDefault.change).toBe("unchanged");
    expect(withFirst).toMatchObject({ change: "changed", baseStatus: "up" });
    expect(withFirst.services[0]).toMatchObject({
      port: 22,
      change: "changed",
      before: { observed: { version: "9.6p1" } },
    });
    expect((await client.get(`/v1/scans/${second}/hosts/${wiki}?base=${third}`)).status).toBe(400);
  });

  it("answers 404 for a host the scan did not see", async () => {
    const { first } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });

    // 10.0.5.8 was down in the first scan and is up only in the second.
    expect((await client.get(`/v1/scans/${first}/hosts/${await hostIdOf("10.0.5.8")}`)).status).toBe(404);
    expect((await client.get(`/v1/scans/${first}/hosts/${randomUUID()}`)).status).toBe(404);
  });
});

describe("GET /scans/{id}/changes", () => {
  it("lists every change, one row each, with its priority", async () => {
    const { first, second } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });

    const { baseScan, items } = ScanChangesResponseSchema.parse(
      await getJson(client, `/v1/scans/${second}/changes`),
    );
    const empty = ScanChangesResponseSchema.parse(await getJson(client, `/v1/scans/${first}/changes`));

    expect(baseScan?.id).toBe(first);
    expect(
      items.map((row) => [row.ip, row.port, row.change, row.field, row.before, row.after, row.priority, row.reason]),
    ).toEqual([
      ["10.0.5.7", 22, "changed", "service.version", "9.6p1", "9.7p1", "medium", "version-change"],
      ["10.0.5.7", 8080, "new", null, null, null, "medium", "new-service"],
      ["10.0.5.8", null, "new", null, "down", "up", "high", "new-host"],
      ["10.0.5.8", 22, "new", null, null, "ssh OpenSSH 9.6p1", "medium", "new-service"],
      ["10.0.5.20", null, "gone", null, "up", "down", "low", "host-gone"],
      ["10.0.5.20", 3306, "gone", null, "mysql MySQL 8.0.36", null, "low", "service-gone"],
    ]);
    expect(items.find((row) => row.ip === "10.0.5.20")?.lifecycle).toEqual({
      state: "missing",
      misses: 1,
      flips: 1,
    });
    expect(empty).toMatchObject({ baseScan: null, items: [] });
  });

  it("exports the same rows as CSV, as a download", async () => {
    const { second } = await twoScans();
    const { client } = await signInAs(server, { role: "viewer" });

    const res = await client.get(`/v1/scans/${second}/changes?format=csv`);
    const lines = (await res.text()).trimEnd().split("\r\n");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="?scan-changes-\w+-to-\w+\.csv"?/);
    expect(lines[0]).toBe(
      "ip,hostnames,protocol,port,change,field,endpoint,key,before,after,priority,reason,lifecycle,rule,muted",
    );
    expect(lines).toHaveLength(7);
    expect(lines).toContain("10.0.5.8,,,,new,,,,down,up,high,new-host,active,,false");
  });
});

async function tag(client: TestClient, scanId: string, body: TagScanHostsBody) {
  const res = await client.post(`/v1/scans/${scanId}/hosts/tags`, { body });
  expect(res.status).toBe(200);
  return TagScanHostsResponseSchema.parse(await res.json());
}

const tagsOf = async (ip: string) => (await prisma.host.findUniqueOrThrow({ where: { ip } })).tags;

// The second scan lists 10.0.5.7 (changed), 10.0.5.8 (new) and 10.0.5.20 (gone).
describe("POST /scans/{id}/hosts/tags", () => {
  it("adds the tag to the scan's hosts inside the selectors, gone hosts included", async () => {
    const { first, second } = await twoScans();
    const { client } = await signInAs(server, { role: "analyst" });
    await prisma.host.update({ where: { ip: "10.0.5.7" }, data: { tags: ["wiki"] } });

    const body: TagScanHostsBody = { action: "add", tag: " dmz ", selectors: ["10.0.5.0/29", "10.0.5.20"] };
    expect(await tag(client, second, body)).toEqual({
      matched: 2,
      changed: 2,
      unchanged: 0,
      limitReached: 0,
    });

    expect(await tagsOf("10.0.5.7")).toEqual(["wiki", "dmz"]);
    expect(await tagsOf("10.0.5.20")).toEqual(["dmz"]);
    expect(await tagsOf("10.0.5.8")).toEqual([]);
    // Tags are on the Host asset, so the earlier scan shows them too (PDF item 14).
    const { items } = ScanHostListResponseSchema.parse(
      await getJson(client, `/v1/scans/${first}/hosts`),
    );
    expect(items.find((host) => host.ip === "10.0.5.7")?.tags).toEqual(["wiki", "dmz"]);

    expect(await tag(client, second, body)).toEqual({
      matched: 2,
      changed: 0,
      unchanged: 2,
      limitReached: 0,
    });
  });

  it("skips hosts that already have the most tags allowed", async () => {
    const { second } = await twoScans();
    const { client } = await signInAs(server, { role: "editor" });
    const full = Array.from({ length: MAX_TAGS }, (_, index) => `tag-${index}`);
    await prisma.host.update({ where: { ip: "10.0.5.8" }, data: { tags: full } });

    expect(await tag(client, second, { action: "add", tag: "dmz", selectors: ["10.0.5.0/24"] })).toEqual({
      matched: 3,
      changed: 2,
      unchanged: 0,
      limitReached: 1,
    });
    expect(await tagsOf("10.0.5.8")).toEqual(full);
  });

  it("removes the tag and counts the hosts that did not have it", async () => {
    const { second } = await twoScans();
    const { client } = await signInAs(server, { role: "analyst" });
    await prisma.host.update({ where: { ip: "10.0.5.7" }, data: { tags: ["dmz", "wiki"] } });
    await prisma.host.update({ where: { ip: "10.0.5.20" }, data: { tags: ["dmz"] } });

    const body: TagScanHostsBody = { action: "remove", tag: "dmz", selectors: ["10.0.5.0/24"] };
    expect(await tag(client, second, body)).toEqual({
      matched: 3,
      changed: 2,
      unchanged: 1,
      limitReached: 0,
    });
    expect(await tagsOf("10.0.5.7")).toEqual(["wiki"]);
    expect(await tagsOf("10.0.5.20")).toEqual([]);
  });

  it("matches nothing outside the scan's hosts", async () => {
    const { first } = await twoScans();
    const { client } = await signInAs(server, { role: "analyst" });

    // 10.0.5.8 was down in the first scan: it is not one of that scan's hosts.
    const body: TagScanHostsBody = { action: "add", tag: "dmz", selectors: ["10.0.5.8", "192.168.0.0/16"] };
    expect(await tag(client, first, body)).toEqual({
      matched: 0,
      changed: 0,
      unchanged: 0,
      limitReached: 0,
    });
    expect(await tagsOf("10.0.5.8")).toEqual([]);
  });

  it("rejects invalid input and unknown scans", async () => {
    const { second } = await twoScans();
    const { client } = await signInAs(server, { role: "analyst" });
    const post = (scanId: string, body: unknown) =>
      client.post(`/v1/scans/${scanId}/hosts/tags`, { body });

    expect((await post(second, { action: "add", tag: "dmz", selectors: ["foo"] })).status).toBe(400);
    expect((await post(second, { action: "add", tag: "dmz", selectors: [] })).status).toBe(400);
    expect((await post(second, { action: "add", tag: "  ", selectors: ["10.0.5.7"] })).status).toBe(400);
    expect((await post(second, { action: "drop", tag: "dmz", selectors: ["10.0.5.7"] })).status).toBe(
      400,
    );
    const valid = { action: "add", tag: "dmz", selectors: ["10.0.5.7"] };
    expect((await post(randomUUID(), valid)).status).toBe(404);
  });

  it("lets only roles with hosts:update tag", async () => {
    const { second } = await twoScans();
    const path = `/v1/scans/${second}/hosts/tags`;
    const edit = { body: { action: "add", tag: "dmz", selectors: ["10.0.5.7"] } };

    expect((await new TestClient(server.baseUrl).post(path, edit)).status).toBe(401);
    for (const role of ["admin", "editor", "analyst", "viewer"] as const) {
      const { client } = await signInAs(server, { role });
      expect((await client.post(path, edit)).status).toBe(role === "viewer" ? 403 : 200);
    }
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
