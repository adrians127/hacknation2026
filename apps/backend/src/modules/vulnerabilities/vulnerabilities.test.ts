import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import {
  JobRequestSchema,
  PackageMappingListResponseSchema,
  PackageMappingSchema,
  ServiceVulnerabilityTriageSchema,
  SyncRunListResponseSchema,
  VulnerabilitySourceListResponseSchema,
  VulnerabilitySourceSchema,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { isEncryptedValue } from "~backend/lib/crypto";
import { prisma } from "~backend/lib/prisma";
import { serviceWithMatch } from "~backend/modules/vulnerabilities/test/matches";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const errorCode = async (res: Response) => ErrorResponseSchema.parse(await res.json()).error.code;

describe("vulnerability sources", () => {
  it("lists the configured sources with their sync state", async () => {
    const { client } = await signInAs(server, { role: "viewer" });
    const res = await client.get("/v1/vulnerabilities/sources");
    expect(res.status).toBe(200);
    const body = VulnerabilitySourceListResponseSchema.parse(await res.json());
    expect(body.syncProcessActive).toBe(false);
    expect(body.items.map((source) => [source.id, source.enabled, source.lastFullAt])).toEqual([
      ["nvd", true, null],
      ["osv", true, null],
    ]);
    expect(body.items[1].scopes).toContain("Debian");
  });

  it("queues one sync request per source and mode for the sync process", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const first = await client.post("/v1/vulnerabilities/sources/nvd/sync", {
      body: { mode: "full" },
    });
    expect(first.status).toBe(202);
    const request = JobRequestSchema.parse(await first.json());
    expect(request).toMatchObject({ kind: "full_sync", sourceId: "nvd" });

    const again = await client.post("/v1/vulnerabilities/sources/nvd/sync", {
      body: { mode: "full" },
    });
    expect(JobRequestSchema.parse(await again.json()).id).toBe(request.id);

    const sources = VulnerabilitySourceListResponseSchema.parse(
      await (await client.get("/v1/vulnerabilities/sources")).json(),
    );
    expect(sources.items[0].pendingRequest?.id).toBe(request.id);
    const unknown = await client.post("/v1/vulnerabilities/sources/unknown/sync", {
      body: { mode: "full" },
    });
    expect(unknown.status).toBe(404);
  });

  it("disables a source, queues a re-match and refuses to sync it", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const res = await client.patch("/v1/vulnerabilities/sources/osv", { body: { enabled: false } });
    expect(res.status).toBe(200);
    expect(VulnerabilitySourceSchema.parse(await res.json()).enabled).toBe(false);
    expect(await prisma.vulnerabilityJobRequest.count({ where: { kind: "rematch" } })).toBe(1);

    const sync = await client.post("/v1/vulnerabilities/sources/osv/sync", {
      body: { mode: "incremental" },
    });
    expect(sync.status).toBe(409);
    expect(await errorCode(sync)).toBe("SOURCE_DISABLED");
  });

  it("lists a source's runs, newest first", async () => {
    await prisma.vulnerabilitySource.create({ data: { id: "nvd" } });
    await prisma.vulnerabilitySyncRun.createMany({
      data: [
        { sourceId: "nvd", mode: "full", trigger: "cli", startedAt: new Date("2026-11-20") },
        {
          sourceId: "nvd",
          mode: "incremental",
          trigger: "schedule",
          status: "succeeded",
          startedAt: new Date("2026-11-21"),
          stats: { upserted: 3 },
        },
      ],
    });
    const { client } = await signInAs(server, { role: "viewer" });
    const res = await client.get("/v1/vulnerabilities/sources/nvd/runs");
    const { items } = SyncRunListResponseSchema.parse(await res.json());
    expect(items.map((run) => [run.mode, run.stats.upserted, run.stats.swept])).toEqual([
      ["incremental", 3, 0],
      ["full", 0, 0],
    ]);
  });
});

describe("package mappings", () => {
  const body = {
    cpeVendor: "eclipse",
    cpeProduct: "jetty",
    ecosystem: "Maven",
    packageName: "org.eclipse.jetty:jetty-io",
  };

  it("adds and removes mappings, each change queueing a re-match", async () => {
    const { client, user } = await signInAs(server, { role: "editor" });
    const created = await client.post("/v1/vulnerabilities/mappings", { body });
    expect(created.status).toBe(201);
    const mapping = PackageMappingSchema.parse(await created.json());
    expect(mapping.createdBy).toEqual({ id: user.id, displayName: "Test User" });

    const duplicate = await client.post("/v1/vulnerabilities/mappings", { body });
    expect(duplicate.status).toBe(409);
    expect(await errorCode(duplicate)).toBe("PACKAGE_MAPPING_EXISTS");

    const list = PackageMappingListResponseSchema.parse(
      await (await client.get("/v1/vulnerabilities/mappings")).json(),
    );
    expect(list.items.map((item) => item.packageName)).toEqual(["org.eclipse.jetty:jetty-io"]);
    expect(list.ecosystems).toEqual(expect.arrayContaining(["Maven", "Debian", "npm"]));

    expect((await client.delete(`/v1/vulnerabilities/mappings/${mapping.id}`)).status).toBe(204);
    expect((await client.delete(`/v1/vulnerabilities/mappings/${mapping.id}`)).status).toBe(404);
    // One waiting request covers every change.
    expect(await prisma.vulnerabilityJobRequest.count({ where: { kind: "rematch" } })).toBe(1);
  });

  it("rejects names that are not CPE names", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const res = await client.post("/v1/vulnerabilities/mappings", {
      body: { ...body, cpeProduct: "Jetty Server" },
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /vulnerabilities/services/{serviceId}/{canonicalId}", () => {
  it("stores the verdict, the note encrypted, and keeps them across retraction", async () => {
    const { serviceId, canonicalId } = await serviceWithMatch();
    const { client } = await signInAs(server, { role: "analyst" });
    const path = `/v1/vulnerabilities/services/${serviceId}/${canonicalId}`;

    const res = await client.patch(path, {
      body: { triage: "accepted_risk", note: " Behind the VPN only " },
    });
    expect(res.status).toBe(200);
    expect(ServiceVulnerabilityTriageSchema.parse(await res.json())).toEqual({
      serviceId,
      canonicalId,
      triage: "accepted_risk",
      note: "Behind the VPN only",
    });
    const stored = await prisma.serviceVulnerabilityTriage.findFirstOrThrow();
    expect(isEncryptedValue(stored.note)).toBe(true);

    await prisma.vulnerabilityMatch.updateMany({
      data: { status: "retracted", retractReason: "service_changed" },
    });
    const triageOnly = await client.patch(path, { body: { triage: "important" } });
    expect(ServiceVulnerabilityTriageSchema.parse(await triageOnly.json())).toMatchObject({
      triage: "important",
      note: "Behind the VPN only",
    });
  });

  it("answers 404 for a vulnerability the service never had", async () => {
    const { serviceId } = await serviceWithMatch();
    const { client } = await signInAs(server, { role: "analyst" });
    const res = await client.patch(`/v1/vulnerabilities/services/${serviceId}/CVE-2000-0001`, {
      body: { triage: "important" },
    });
    expect(res.status).toBe(404);
  });
});
