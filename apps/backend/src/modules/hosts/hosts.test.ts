import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HostDetailSchema,
  HostListResponseSchema,
  ServiceDetailSchema,
} from "@subsurf/contracts/hosts/hosts.schema";
import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";
import type { ObservedHost, WorkerResult } from "@subsurf/contracts/workers/worker-result.schema";

import { isEncryptedValue } from "~backend/lib/crypto";
import { prisma } from "~backend/lib/prisma";
import { resultsService } from "~backend/modules/results/results.service";
import { createUser, signInAs } from "~backend/test/auth";
import { startTestServer, TestClient, type TestServer } from "~backend/test/http";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

/** Queues a one-job scan of 10.0.5.0/24 and ingests the example result, edited by `edit`. */
async function ingestScan(edit: (hosts: ObservedHost[]) => ObservedHost[] = (hosts) => hosts) {
  const user = await createUser({ role: "admin" });
  const scan = await prisma.scan.create({
    data: {
      ports: "21-23,80,443,3306,8000-8100",
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
  const result: WorkerResult = buildWorkerResult({
    scanId: scan.id,
    jobId: job.id,
    leaseId: randomUUID(),
  });
  await resultsService.ingest({ ...result, hosts: edit(result.hosts) });
}

/** The example's `up` host, moved to another address with only a MySQL port. */
function databaseHost(hosts: ObservedHost[]): ObservedHost {
  const [wiki] = hosts;
  const [ssh] = wiki.ports;
  return {
    ...wiki,
    ip: "10.0.5.20",
    hostnames: [{ name: "db01.example.org", source: "ptr" }],
    ports: [
      {
        ...ssh,
        port: 3306,
        service: { ...ssh.service!, name: "mysql", product: "MySQL", version: "8.0.36" },
        banner: null,
      },
    ],
  };
}

const withDatabaseHost = (hosts: ObservedHost[]) => [...hosts, databaseHost(hosts)];

async function listHosts(client: TestClient, query = "") {
  const res = await client.get(`/v1/hosts${query}`);
  expect(res.status).toBe(200);
  return HostListResponseSchema.parse(await res.json());
}

async function hostId(ip: string) {
  return (await prisma.host.findUniqueOrThrow({ where: { ip } })).id;
}

async function serviceId(ip: string, port: number) {
  const host = await prisma.host.findUniqueOrThrow({ where: { ip }, include: { services: true } });
  return host.services.find((service) => service.port === port)!.id;
}

describe("GET /hosts", () => {
  it("lists hosts that were up, with services, names and plaintext HTTP summaries", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "viewer" });

    const { items, total } = await listHosts(client);

    expect(total).toBe(1);
    const [host] = items;
    expect(host).toMatchObject({
      ip: "10.0.5.7",
      hostnames: ["wiki.example.org", "web01.example.org"],
      lastStatus: "up",
      triage: "unreviewed",
      note: "",
      tags: [],
    });
    expect(host.services.map((service) => [service.port, service.observed.product])).toEqual([
      [22, "OpenSSH"],
      [443, "nginx"],
    ]);
    expect(host.services.every((service) => service.seenInLatestScan)).toBe(true);
    const https = host.services[1];
    expect(https.http.map((endpoint) => [endpoint.vhost, endpoint.statusCode, endpoint.title])).toEqual([
      ["wiki.example.org", 200, "Wiki – login"],
      [null, 404, null],
    ]);
    // The list never decrypts: headers, cookies and certificates stay in the detail view.
    expect(JSON.stringify(items)).not.toContain("PHPSESSID");
  });

  it("searches by IP prefix, hostname, port, product and tag, and pages", async () => {
    await ingestScan(withDatabaseHost);
    const { client } = await signInAs(server, { role: "editor" });
    await client.patch(`/v1/hosts/${await hostId("10.0.5.20")}`, { body: { tags: ["dmz-db"] } });

    const ipsFor = async (query: string) =>
      (await listHosts(client, query)).items.map((host) => host.ip);

    expect(await ipsFor("")).toEqual(["10.0.5.7", "10.0.5.20"]);
    expect(await ipsFor("?q=10.0.5.2")).toEqual(["10.0.5.20"]);
    expect(await ipsFor("?q=WIKI")).toEqual(["10.0.5.7"]);
    expect(await ipsFor("?q=3306")).toEqual(["10.0.5.20"]);
    expect(await ipsFor("?q=mysql")).toEqual(["10.0.5.20"]);
    expect(await ipsFor("?q=dmz-db")).toEqual(["10.0.5.20"]);
    expect(await ipsFor("?q=nothing-matches")).toEqual([]);

    const secondPage = await listHosts(client, "?page=2&pageSize=1");
    expect(secondPage).toMatchObject({ total: 2, page: 2, pageSize: 1 });
    expect(secondPage.items.map((host) => host.ip)).toEqual(["10.0.5.20"]);

    expect((await client.get("/v1/hosts?pageSize=1000")).status).toBe(400);
  });

  it("filters by the triage status of the host or any of its services", async () => {
    await ingestScan(withDatabaseHost);
    const { client } = await signInAs(server, { role: "analyst" });
    await client.patch(`/v1/hosts/${await hostId("10.0.5.7")}/services/${await serviceId("10.0.5.7", 443)}`, {
      body: { triage: "important" },
    });

    const important = await listHosts(client, "?triage=important");

    expect(important.items.map((host) => host.ip)).toEqual(["10.0.5.7"]);
  });
});

describe("GET /hosts/{id}", () => {
  it("returns decrypted details and the scan history of the address", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "viewer" });

    const res = await client.get(`/v1/hosts/${await hostId("10.0.5.7")}`);

    expect(res.status).toBe(200);
    const host = HostDetailSchema.parse(await res.json());
    const [ssh, https] = host.services;
    expect(ssh).toMatchObject({
      banner: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13",
      extraInfo: "Ubuntu 3ubuntu13",
      cpe: ["cpe:/a:openbsd:openssh:9.6p1"],
      confidence: 10,
      observedAt: "2026-11-21T14:03:11.000Z",
    });
    const [wiki] = https.http;
    expect(wiki.headers).toContainEqual({ name: "x-powered-by", value: "PHP/8.1.2" });
    expect(wiki.cookies.map((cookie) => cookie.name)).toEqual(["PHPSESSID"]);
    expect(wiki.tls?.cert.subjectCn).toBe("wiki.example.org");
    expect(wiki.probes.map((probe) => probe.path)).toEqual(["/wp-admin/"]);
    expect(host.history).toEqual([
      expect.objectContaining({ status: "up", latencyMs: 3, openPorts: 2 }),
    ]);
  });

  it("answers 404 for an unknown host", async () => {
    const { client } = await signInAs(server, { role: "viewer" });

    expect((await client.get(`/v1/hosts/${randomUUID()}`)).status).toBe(404);
  });
});

describe("editing hosts and services", () => {
  it("stores the host note encrypted and returns it decrypted", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "analyst" });
    const id = await hostId("10.0.5.7");

    const res = await client.patch(`/v1/hosts/${id}`, {
      body: { note: "Wiki of the network team", tags: ["wiki", " wiki ", "dmz"], triage: "reviewed" },
    });

    expect(res.status).toBe(200);
    expect(HostDetailSchema.parse(await res.json())).toMatchObject({
      note: "Wiki of the network team",
      tags: ["wiki", "dmz"],
      triage: "reviewed",
    });
    const row = await prisma.host.findUniqueOrThrow({ where: { id } });
    expect(isEncryptedValue(row.note)).toBe(true);
    expect(JSON.stringify(row.note)).not.toContain("network team");

    await client.patch(`/v1/hosts/${id}`, { body: { note: "" } });
    expect((await prisma.host.findUniqueOrThrow({ where: { id } })).note).toBeNull();
  });

  it("corrects a service and clears the correction with null", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "editor" });
    const path = `/v1/hosts/${await hostId("10.0.5.7")}/services/${await serviceId("10.0.5.7", 443)}`;

    const corrected = await client.patch(path, {
      body: { productOverride: "Kibana behind nginx", versionOverride: "8.15.0", note: "SSO only" },
    });

    expect(corrected.status).toBe(200);
    expect(ServiceDetailSchema.parse(await corrected.json())).toMatchObject({
      port: 443,
      observed: { name: "https", product: "nginx", version: "1.24.0" },
      overrides: { name: null, product: "Kibana behind nginx", version: "8.15.0" },
      note: "SSO only",
    });

    const cleared = await client.patch(path, { body: { productOverride: null } });
    expect(ServiceDetailSchema.parse(await cleared.json()).overrides).toEqual({
      name: null,
      product: null,
      version: "8.15.0",
    });
  });

  it("rejects an empty body, a blank correction and a service of another host", async () => {
    await ingestScan(withDatabaseHost);
    const { client } = await signInAs(server, { role: "admin" });
    const wikiId = await hostId("10.0.5.7");
    const foreignService = await serviceId("10.0.5.20", 3306);

    expect((await client.patch(`/v1/hosts/${wikiId}`, { body: {} })).status).toBe(400);
    expect(
      (await client.patch(`/v1/hosts/${wikiId}/services/${foreignService}`, { body: { triage: "reviewed" } }))
        .status,
    ).toBe(404);
    expect(
      (
        await client.patch(`/v1/hosts/${wikiId}/services/${await serviceId("10.0.5.7", 22)}`, {
          body: { nameOverride: "   " },
        })
      ).status,
    ).toBe(400);
    expect((await client.patch(`/v1/hosts/${randomUUID()}`, { body: { triage: "reviewed" } })).status).toBe(
      404,
    );
  });

  // PDF item 14: edits do not depend on the scan state and survive later scans.
  it("keeps user edits when later scans see the host change and go down", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "analyst" });
    const id = await hostId("10.0.5.7");
    const sshPath = `/v1/hosts/${id}/services/${await serviceId("10.0.5.7", 22)}`;
    await client.patch(`/v1/hosts/${id}`, { body: { note: "keep me", tags: ["dmz"], triage: "important" } });
    await client.patch(sshPath, { body: { productOverride: "OpenSSH (bastion)", tags: ["bastion"] } });

    await ingestScan((hosts) => {
      const [wiki, ...rest] = hosts;
      const [ssh, https] = wiki.ports;
      const upgraded = { ...ssh, service: { ...ssh.service!, version: "9.7p1" } };
      return [{ ...wiki, ports: [upgraded, https] }, ...rest];
    });

    const afterChange = HostDetailSchema.parse(await (await client.get(`/v1/hosts/${id}`)).json());
    expect(afterChange).toMatchObject({ note: "keep me", tags: ["dmz"], triage: "important" });
    expect(afterChange.services[0]).toMatchObject({
      observed: { product: "OpenSSH", version: "9.7p1" },
      overrides: { product: "OpenSSH (bastion)" },
      tags: ["bastion"],
      seenInLatestScan: true,
    });
    expect(afterChange.history).toHaveLength(2);

    await ingestScan((hosts) => {
      const [wiki, ...rest] = hosts;
      return [{ ...wiki, status: "down", reason: "no-response", hostnames: [], ports: [] }, ...rest];
    });

    const afterDown = HostDetailSchema.parse(await (await client.get(`/v1/hosts/${id}`)).json());
    expect(afterDown).toMatchObject({ lastStatus: "down", note: "keep me", triage: "important" });
    expect(afterDown.services[0]).toMatchObject({
      seenInLatestScan: false,
      overrides: { product: "OpenSSH (bastion)" },
    });
    expect(afterDown.history.map((entry) => entry.status)).toEqual(["down", "up", "up"]);
  });
});

describe("hosts RBAC", () => {
  it("lets every role read, and only roles with hosts:update edit", async () => {
    await ingestScan();
    const id = await hostId("10.0.5.7");
    const edit = { body: { triage: "reviewed" } };

    expect((await new TestClient(server.baseUrl).get("/v1/hosts")).status).toBe(401);
    for (const role of ["admin", "editor", "analyst", "viewer"] as const) {
      const { client } = await signInAs(server, { role });
      expect((await client.get("/v1/hosts")).status).toBe(200);
      expect((await client.get(`/v1/hosts/${id}`)).status).toBe(200);
      expect((await client.patch(`/v1/hosts/${id}`, edit)).status).toBe(role === "viewer" ? 403 : 200);
    }
  });
});
