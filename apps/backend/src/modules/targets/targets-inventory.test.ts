import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SYSTEM_ROLE_KEYS } from "@subsurf/contracts/auth/permissions";
import {
  ImportTargetsResponseSchema,
  TargetListResponseSchema,
  TargetSchema,
} from "@subsurf/contracts/targets/targets.schema";

import { decryptJson, isEncryptedValue } from "~backend/lib/crypto";
import { encryptLegacyRows } from "~backend/lib/encrypt-legacy";
import { prisma } from "~backend/lib/prisma";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestClient, type TestServer } from "~backend/test/http";
import { ingestScan } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

interface Entry {
  value: string;
  note?: string;
}

async function importTargets(client: TestClient, entries: Entry[], tags?: string[]) {
  const res = await client.post("/v1/targets/import", { body: { entries, startScan: false, tags } });
  expect(res.status).toBe(201);
  return ImportTargetsResponseSchema.parse(await res.json());
}

async function list(client: TestClient, query = "") {
  const res = await client.get(`/v1/targets${query}`);
  expect(res.status).toBe(200);
  return TargetListResponseSchema.parse(await res.json());
}

const idOf = async (value: string) => (await prisma.target.findUniqueOrThrow({ where: { value } })).id;

/** The scan of 10.0.5.0/24 that `ingestScan` writes, linked to the targets as a real run is. */
async function scanCovering(values: string[]): Promise<string> {
  const scanId = await ingestScan();
  await prisma.scanTarget.createMany({
    data: await Promise.all(values.map(async (value) => ({ scanId, targetId: await idOf(value) }))),
  });
  return scanId;
}

describe("GET /targets", () => {
  it("lists the inventory in address order, a block before what it holds and domains last", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    await importTargets(client, [
      { value: "zeta.example.org" },
      { value: "192.0.2.10" },
      { value: "10.0.5.7" },
      { value: "alpha.example.org" },
      { value: "10.0.5.0/24", note: "Lab network" },
      { value: "10.0.0.0/16" },
    ]);

    const page = await list(client);

    expect(page).toMatchObject({ total: 6, page: 1, pageSize: 50 });
    expect(page.items.map((target) => target.value)).toEqual([
      "10.0.0.0/16",
      "10.0.5.0/24",
      "10.0.5.7",
      "192.0.2.10",
      "alpha.example.org",
      "zeta.example.org",
    ]);
    expect(page.items[1]).toMatchObject({
      kind: "cidr",
      note: "Lab network",
      tags: [],
      activeHosts: 0,
      lastScanId: null,
      lastScanAt: null,
    });
  });

  it("pages, and filters by kind, tag and search", async () => {
    const { client } = await signInAs(server, { role: "viewer" });
    const { client: editor } = await signInAs(server, { role: "editor" });
    await importTargets(editor, [{ value: "10.0.5.0/24" }, { value: "10.0.9.0/24" }], ["lab"]);
    await importTargets(editor, [{ value: "192.0.2.10" }, { value: "wiki.example.org" }], ["dmz"]);
    const values = async (query: string) => (await list(client, query)).items.map((target) => target.value);

    const second = await list(client, "?page=2&pageSize=3");
    expect(second).toMatchObject({ total: 4, page: 2, pageSize: 3 });
    expect(second.items.map((target) => target.value)).toEqual(["wiki.example.org"]);

    expect(await values("?kind=cidr")).toEqual(["10.0.5.0/24", "10.0.9.0/24"]);
    expect(await values("?tag=dmz")).toEqual(["192.0.2.10", "wiki.example.org"]);
    expect(await values("?q=EXAMPLE")).toEqual(["wiki.example.org"]);
    expect(await values("?q=lab")).toEqual(["10.0.5.0/24", "10.0.9.0/24"]);
    // An address finds the block that holds it; a wildcard is not one.
    expect(await values("?q=10.0.9.77")).toEqual(["10.0.9.0/24"]);
    expect(await values("?q=10.0._.0")).toEqual([]);
    expect(await values("?q=nothing-like-this")).toEqual([]);
    expect((await client.get("/v1/targets?pageSize=500")).status).toBe(400);
    expect((await client.get("/v1/targets?kind=range")).status).toBe(400);
  });

  it("shows each target's last scan with results and the hosts up in it", async () => {
    const { client } = await signInAs(server, { role: "viewer" });
    const { client: editor } = await signInAs(server, { role: "editor" });
    await importTargets(editor, [
      { value: "10.0.5.0/24" },
      { value: "10.0.5.8" },
      { value: "wiki.example.org" },
      { value: "10.0.9.0/24" },
    ]);
    const scanId = await scanCovering(["10.0.5.0/24", "10.0.5.8", "wiki.example.org"]);

    const { items } = await list(client);

    // The example scan found 10.0.5.7 up (it serves wiki.example.org) and 10.0.5.8 down.
    expect(items.map((target) => [target.value, target.activeHosts, target.lastScanId])).toEqual([
      ["10.0.5.0/24", 1, scanId],
      ["10.0.5.8", 0, scanId],
      ["10.0.9.0/24", 0, null],
      ["wiki.example.org", 1, scanId],
    ]);
    expect(items[0].lastScanAt).not.toBeNull();
  });

  it("answers every system role, and nobody without a session", async () => {
    for (const role of SYSTEM_ROLE_KEYS) {
      const { client } = await signInAs(server, { role });
      expect((await client.get("/v1/targets")).status, `as ${role}`).toBe(200);
    }
    expect((await fetch(`${server.baseUrl}/v1/targets`)).status).toBe(401);
  });
});

describe("PATCH /targets/{id}", () => {
  it("changes the note and the tags, and encrypts the note at rest", async () => {
    const { client } = await signInAs(server, { role: "analyst" });
    const { client: editor } = await signInAs(server, { role: "editor" });
    await importTargets(editor, [{ value: "10.0.5.0/24", note: "Lab network" }], ["lab"]);
    const id = await idOf("10.0.5.0/24");

    const res = await client.patch(`/v1/targets/${id}`, {
      body: { note: "  Owned by the lab team  ", tags: [" dmz ", "lab", "dmz"] },
    });

    expect(res.status).toBe(200);
    expect(TargetSchema.parse(await res.json())).toMatchObject({
      id,
      value: "10.0.5.0/24",
      note: "Owned by the lab team",
      tags: ["dmz", "lab"],
    });
    const stored = JSON.stringify(
      await prisma.target.findUniqueOrThrow({ where: { id }, select: { note: true } }),
    );
    expect(stored).toContain('"$enc"');
    expect(stored).not.toContain("lab team");

    // An empty note is no note; a field left out stays.
    await client.patch(`/v1/targets/${id}`, { body: { note: "" } });
    expect((await prisma.target.findUniqueOrThrow({ where: { id } })).note).toBeNull();
    expect((await list(client)).items[0]).toMatchObject({ note: "", tags: ["dmz", "lab"] });
  });

  it("keeps the edit when the same value is imported again (PDF item 14)", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    await importTargets(client, [{ value: "192.0.2.10", note: "first" }]);
    await client.patch(`/v1/targets/${await idOf("192.0.2.10")}`, {
      body: { note: "Edited by hand", tags: ["kept"] },
    });

    const again = await importTargets(client, [{ value: "192.0.2.10", note: "from the file" }], ["new"]);

    expect(again).toMatchObject({ created: 0, skipped: 1 });
    expect((await list(client)).items[0]).toMatchObject({ note: "Edited by hand", tags: ["kept"] });
  });

  it("rejects invalid input, unknown targets and roles that may not update", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const { client: viewer } = await signInAs(server, { role: "viewer" });
    await importTargets(client, [{ value: "192.0.2.10" }]);
    const path = `/v1/targets/${await idOf("192.0.2.10")}`;

    expect((await client.patch(path, { body: {} })).status).toBe(400);
    expect((await client.patch(path, { body: { note: "x".repeat(501) } })).status).toBe(400);
    expect((await client.patch(path, { body: { value: "192.0.2.11" } })).status).toBe(400);
    expect((await client.patch(`/v1/targets/${randomUUID()}`, { body: { note: "x" } })).status).toBe(404);
    expect((await viewer.patch(path, { body: { note: "x" } })).status).toBe(403);
  });
});

describe("DELETE /targets/{id}", () => {
  it("removes the target but keeps the scans that covered it and their hosts", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const { client: analyst } = await signInAs(server, { role: "analyst" });
    await importTargets(client, [{ value: "10.0.5.0/24" }, { value: "192.0.2.10" }]);
    const scanId = await scanCovering(["10.0.5.0/24"]);
    const path = `/v1/targets/${await idOf("10.0.5.0/24")}`;

    expect((await analyst.delete(path)).status).toBe(403);
    const res = await client.delete(path);

    expect(res.status).toBe(204);
    expect((await list(client)).items.map((target) => target.value)).toEqual(["192.0.2.10"]);
    expect(await prisma.scanTarget.count()).toBe(0);
    expect(await prisma.scan.count({ where: { id: scanId } })).toBe(1);
    expect(await prisma.hostObservation.count({ where: { scanId } })).toBe(4);
    expect(await prisma.host.count()).toBe(1);
    expect((await client.delete(path)).status).toBe(404);
  });
});

describe("encryptLegacyRows", () => {
  it("encrypts notes a migration left as plain strings, once", async () => {
    const { client, user } = await signInAs(server, { role: "editor" });
    await importTargets(client, [{ value: "192.0.2.10", note: "Already encrypted" }]);
    // As the migration leaves them: the old text column's value as a JSON string.
    await prisma.$executeRaw`
      INSERT INTO "Target" (id, kind, value, note, "createdById", "updatedAt")
      VALUES (${randomUUID()}::uuid, 'ip', '192.0.2.11', to_jsonb('Legacy note'::text), ${user.id}::uuid, now()),
             (${randomUUID()}::uuid, 'ip', '192.0.2.12', NULL, ${user.id}::uuid, now())`;
    expect((await client.get("/v1/targets")).status).toBe(500);

    expect(await encryptLegacyRows()).toBe(1);
    expect(await encryptLegacyRows()).toBe(0);

    const { items } = await list(client);
    expect(items.map((target) => target.note)).toEqual(["Already encrypted", "Legacy note", ""]);
    const stored = await prisma.target.findMany({ select: { note: true } });
    expect(JSON.stringify(stored)).not.toContain("Legacy note");
  });

  it("encrypts scan warnings a migration left as plain lists, once", async () => {
    const warnings = [{ code: "dns_not_found", value: "legacy.example.com" }];
    const none = await ingestScan();
    const legacy = await ingestScan();
    // As the migration leaves them: the list as it was stored before the column was encrypted.
    await prisma.$executeRaw`
      UPDATE "Scan" SET warnings = ${JSON.stringify(warnings)}::jsonb WHERE id = ${legacy}::uuid`;

    expect(await encryptLegacyRows()).toBe(1);
    expect(await encryptLegacyRows()).toBe(0);

    const stored = await prisma.scan.findUniqueOrThrow({ where: { id: legacy }, select: { warnings: true } });
    expect(JSON.stringify(stored)).not.toContain("legacy.example.com");
    expect(isEncryptedValue(stored.warnings) && decryptJson(stored.warnings)).toEqual(warnings);
    expect((await prisma.scan.findUniqueOrThrow({ where: { id: none } })).warnings).toBeNull();
  });
});
