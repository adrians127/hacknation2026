import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HostEditsSchema, ServiceEditsSchema } from "@subsurf/contracts/hosts/hosts.schema";
import { ScanHostListResponseSchema } from "@subsurf/contracts/scans/scan-results.schema";
import type { ObservedHost } from "@subsurf/contracts/workers/worker-result.schema";

import { isEncryptedValue } from "~backend/lib/crypto";
import { prisma } from "~backend/lib/prisma";
import { signInAs } from "~backend/test/auth";
import { startTestServer, TestClient, type TestServer } from "~backend/test/http";
import { databaseHost, hostIdOf, ingestScan, serviceIdOf } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe("PATCH /hosts/{id}", () => {
  it("stores the note encrypted and returns the user-owned fields", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "analyst" });
    const id = await hostIdOf("10.0.5.7");

    const res = await client.patch(`/v1/hosts/${id}`, {
      body: { note: "Wiki of the network team", tags: ["wiki", " wiki ", "dmz"], triage: "reviewed" },
    });

    expect(res.status).toBe(200);
    expect(HostEditsSchema.parse(await res.json())).toEqual({
      id,
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

  it("rejects an empty body and an unknown host", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "admin" });

    expect((await client.patch(`/v1/hosts/${await hostIdOf("10.0.5.7")}`, { body: {} })).status).toBe(400);
    expect(
      (await client.patch(`/v1/hosts/${randomUUID()}`, { body: { triage: "reviewed" } })).status,
    ).toBe(404);
  });
});

describe("PATCH /hosts/{id}/services/{serviceId}", () => {
  it("corrects a service and clears the correction with null", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "editor" });
    const path = `/v1/hosts/${await hostIdOf("10.0.5.7")}/services/${await serviceIdOf("10.0.5.7", 443)}`;

    const corrected = await client.patch(path, {
      body: { productOverride: "Kibana behind nginx", versionOverride: "8.15.0", note: "SSO only" },
    });

    expect(corrected.status).toBe(200);
    expect(ServiceEditsSchema.parse(await corrected.json())).toMatchObject({
      overrides: { name: null, product: "Kibana behind nginx", version: "8.15.0" },
      note: "SSO only",
    });
    const cleared = await client.patch(path, { body: { productOverride: null } });
    expect(ServiceEditsSchema.parse(await cleared.json()).overrides).toEqual({
      name: null,
      product: null,
      version: "8.15.0",
    });
  });

  it("rejects a blank correction and a service of another host", async () => {
    await ingestScan((hosts) => [...hosts, databaseHost(hosts)]);
    const { client } = await signInAs(server, { role: "admin" });
    const wiki = await hostIdOf("10.0.5.7");

    const foreign = `/v1/hosts/${wiki}/services/${await serviceIdOf("10.0.5.20", 3306)}`;
    expect((await client.patch(foreign, { body: { triage: "reviewed" } })).status).toBe(404);
    const own = `/v1/hosts/${wiki}/services/${await serviceIdOf("10.0.5.7", 22)}`;
    expect((await client.patch(own, { body: { nameOverride: "   " } })).status).toBe(400);
  });
});

// PDF item 14: edits do not depend on the scan state and survive later scans.
describe("edits across scans", () => {
  it("keeps user edits when later scans see the host change and go down", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "analyst" });
    const id = await hostIdOf("10.0.5.7");
    await client.patch(`/v1/hosts/${id}`, { body: { note: "keep me", tags: ["dmz"], triage: "important" } });
    await client.patch(`/v1/hosts/${id}/services/${await serviceIdOf("10.0.5.7", 22)}`, {
      body: { productOverride: "OpenSSH (bastion)", tags: ["bastion"] },
    });

    const upgraded = await ingestScan((hosts) => {
      const [wiki, ...rest] = hosts;
      const [ssh, https] = wiki.ports;
      if (!ssh.service) throw new Error("The example's SSH port has a service");
      return [{ ...wiki, ports: [{ ...ssh, service: { ...ssh.service, version: "9.7p1" } }, https] }, ...rest];
    });
    const down = await ingestScan(([wiki, ...rest]): ObservedHost[] => [
      { ...wiki, status: "down", reason: "no-response", hostnames: [], ports: [] },
      ...rest,
    ]);

    const hostIn = async (scanId: string) => {
      const res = await client.get(`/v1/scans/${scanId}/hosts?q=10.0.5.7`);
      return ScanHostListResponseSchema.parse(await res.json()).items[0];
    };
    expect(await hostIn(upgraded)).toMatchObject({
      change: "changed",
      note: "keep me",
      tags: ["dmz"],
      triage: "important",
      services: [
        {
          port: 22,
          change: "changed",
          observed: { product: "OpenSSH", version: "9.7p1" },
          overrides: { product: "OpenSSH (bastion)" },
          tags: ["bastion"],
        },
        { port: 443 },
      ],
    });
    expect(await hostIn(down)).toMatchObject({
      status: "down",
      change: "gone",
      note: "keep me",
      triage: "important",
      services: [{ port: 22, change: "gone", overrides: { product: "OpenSSH (bastion)" } }, { port: 443 }],
    });
  });
});

describe("hosts RBAC", () => {
  it("lets only roles with hosts:update edit", async () => {
    await ingestScan();
    const id = await hostIdOf("10.0.5.7");
    const edit = { body: { triage: "reviewed" } };

    expect((await new TestClient(server.baseUrl).patch(`/v1/hosts/${id}`, edit)).status).toBe(401);
    for (const role of ["admin", "editor", "analyst", "viewer"] as const) {
      const { client } = await signInAs(server, { role });
      expect((await client.patch(`/v1/hosts/${id}`, edit)).status).toBe(role === "viewer" ? 403 : 200);
    }
  });
});
