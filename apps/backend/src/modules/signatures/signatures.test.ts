import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import {
  SIGNATURE_PROBE_PATHS_MAX,
  SignatureExportDocumentSchema,
  SignatureImportResponseSchema,
  SignatureListResponseSchema,
  SignaturePreviewResponseSchema,
  SignatureSchema,
  type SignatureDefinition,
} from "@subsurf/contracts/signatures/signatures.schema";

import { prisma } from "~backend/lib/prisma";
import { signaturesTick } from "~backend/modules/signatures/signatures.scheduler";
import { POWERED_BY_PHP, createSignatureRow, signatureBody } from "~backend/modules/signatures/test/signatures";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestClient, type TestServer } from "~backend/test/http";
import { ingestScan, serviceIdOf } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const silent = pino({ level: "silent" });

async function list(client: TestClient) {
  const res = await client.get("/v1/signatures");
  expect(res.status).toBe(200);
  return SignatureListResponseSchema.parse(await res.json());
}

async function create(client: TestClient, body = signatureBody()) {
  const res = await client.post("/v1/signatures", { body });
  expect(res.status).toBe(201);
  return SignatureSchema.parse(await res.json());
}

const matchesOf = (signatureId: string) =>
  prisma.signatureMatch.findMany({ where: { signatureId }, select: { scanId: true, version: true } });

const errorCode = async (res: Response) => ErrorResponseSchema.parse(await res.json()).error.code;

describe("signatures CRUD", () => {
  it("creates a signature and evaluates the newest scan at once", async () => {
    await ingestScan();
    const scanId = await ingestScan();
    const { client } = await signInAs(server, { role: "editor" });

    const signature = await create(client);
    expect(signature).toMatchObject({ builtIn: false, key: null, hits: { hosts: 1, services: 1 } });
    expect(await matchesOf(signature.id)).toEqual([{ scanId, version: "8.1.2" }]);

    const listed = await list(client);
    expect(listed.items.some((item) => item.key === "wordpress")).toBe(true);
    expect(listed.probePaths).toEqual(expect.arrayContaining(["/wp-login.php", "/server-status", "/login"]));
    // The older scan follows in the background.
    expect(listed.evaluation).toMatchObject({ scan: { id: scanId }, pendingScans: 1 });
  });

  it("only switches built-ins on and off", async () => {
    const { client } = await signInAs(server, { role: "admin" });
    const wordpress = (await list(client)).items.find((item) => item.key === "wordpress")!;

    const renamed = await client.patch(`/v1/signatures/${wordpress.id}`, { body: { name: "WP" } });
    expect(renamed.status).toBe(409);
    expect(await errorCode(renamed)).toBe("SIGNATURE_BUILT_IN");
    const removed = await client.delete(`/v1/signatures/${wordpress.id}`);
    expect(await errorCode(removed)).toBe("SIGNATURE_BUILT_IN");

    const off = await client.patch(`/v1/signatures/${wordpress.id}`, { body: { enabled: false } });
    expect(SignatureSchema.parse(await off.json()).enabled).toBe(false);
  });

  it("refuses a taken name, an invalid pattern and too many probe paths", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const taken = await client.post("/v1/signatures", { body: signatureBody({ name: "WordPress" }) });
    expect(await errorCode(taken)).toBe("SIGNATURE_NAME_TAKEN");

    const lookahead: SignatureDefinition = {
      match: "all",
      conditions: [{ target: "title", value: { op: "regex", value: "(?=admin)" } }],
    };
    const invalid = await client.post("/v1/signatures", { body: signatureBody({ definition: lookahead }) });
    expect(invalid.status).toBe(400);

    const unsafe = await client.post("/v1/signatures", {
      body: signatureBody({
        definition: { match: "all", conditions: [{ target: "probe", path: "/login?user=admin", status: [200] }] },
      }),
    });
    expect(unsafe.status).toBe(400);

    const paths = Array.from({ length: SIGNATURE_PROBE_PATHS_MAX }, (_, index) => ({
      target: "probe" as const,
      path: `/p${index}`,
      status: [200],
    }));
    // The built-ins already need some paths, so the limit is hit before all of these fit.
    const responses: Response[] = [];
    for (let start = 0; start < paths.length; start += 10) {
      responses.push(
        await client.post("/v1/signatures", {
          body: signatureBody({
            name: `Many paths ${start}`,
            definition: { match: "any", conditions: paths.slice(start, start + 10) },
          }),
        }),
      );
    }
    const refused = responses.find((res) => res.status === 409);
    expect(refused && (await errorCode(refused))).toBe("SIGNATURE_PROBE_LIMIT");
    expect((await list(client)).probePaths.length).toBeLessThanOrEqual(SIGNATURE_PROBE_PATHS_MAX + 1);
  });

  it("drops the matches of a disabled or deleted signature and keeps the scans current", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "admin" });
    const signature = await create(client);
    await signaturesTick(silent);
    expect((await list(client)).evaluation.pendingScans).toBe(0);

    await client.patch(`/v1/signatures/${signature.id}`, { body: { enabled: false } });
    expect(await matchesOf(signature.id)).toEqual([]);
    expect((await list(client)).evaluation.pendingScans).toBe(0);

    await client.patch(`/v1/signatures/${signature.id}`, { body: { enabled: true } });
    expect(await matchesOf(signature.id)).toHaveLength(1);
    const res = await client.delete(`/v1/signatures/${signature.id}`);
    expect(res.status).toBe(204);
    expect((await list(client)).evaluation.pendingScans).toBe(0);
  });
});

describe("POST /signatures/preview", () => {
  it("shows what a definition matches without saving anything", async () => {
    await ingestScan();
    const { client } = await signInAs(server, { role: "viewer" });
    const before = await prisma.signatureMatch.count();
    const res = await client.post("/v1/signatures/preview", {
      body: {
        definition: {
          match: "any",
          conditions: [
            ...POWERED_BY_PHP.conditions,
            { target: "probe", path: "/never-requested", status: [200] },
          ],
        },
      },
    });
    const preview = SignaturePreviewResponseSchema.parse(await res.json());
    expect(preview).toMatchObject({ services: 1, hosts: 1, unprobedPaths: ["/never-requested"] });
    expect(preview.samples[0]).toMatchObject({ ip: "10.0.5.7", port: 443, version: "8.1.2" });
    expect(await prisma.signatureMatch.count()).toBe(before);
  });
});

describe("signature export and import", () => {
  it("round-trips custom signatures and switches built-ins by key", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    await create(client);
    const exported = SignatureExportDocumentSchema.parse(
      await (await client.get("/v1/signatures/export?builtIn=true")).json(),
    );
    const custom = exported.signatures.filter((item) => !item.key);
    expect(custom.map((item) => item.name)).toEqual(["PHP in X-Powered-By"]);

    const document = {
      ...exported,
      signatures: exported.signatures.map((item) =>
        item.key === "php" ? { ...item, enabled: false } : item.key ? item : { ...item, severity: "high" as const },
      ),
    };
    const skipped = await client.post("/v1/signatures/import", { body: document });
    expect(SignatureImportResponseSchema.parse(await skipped.json())).toMatchObject({ created: 0, skipped: 1 });

    const replaced = await client.post("/v1/signatures/import?conflict=replace", { body: document });
    expect(SignatureImportResponseSchema.parse(await replaced.json())).toMatchObject({ replaced: 1 });
    const items = (await list(client)).items;
    expect(items.find((item) => item.name === "PHP in X-Powered-By")?.severity).toBe("high");
    expect(items.find((item) => item.key === "php")?.enabled).toBe(false);
  });

  it("imports nothing when one entry is invalid", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const res = await client.post("/v1/signatures/import", {
      body: {
        format: "subsurf.signatures",
        version: 1,
        signatures: [
          signatureBody({ name: "Fine" }),
          signatureBody({
            name: "Broken",
            definition: { match: "all", conditions: [{ target: "body", value: { op: "regex", value: String.raw`(a)\1` } }] },
          }),
        ],
      },
    });
    expect(res.status).toBe(400);
    expect(await prisma.signature.count({ where: { key: null } })).toBe(0);
  });
});

describe("signaturesTick", () => {
  it("evaluates stale scans newest first and follows new results", async () => {
    const older = await ingestScan();
    const newer = await ingestScan();
    const signature = await createSignatureRow();

    await signaturesTick(silent);
    expect((await matchesOf(signature.id)).map((match) => match.scanId).toSorted()).toEqual([older, newer].toSorted());
    const states = await prisma.signatureScanState.findMany();
    await signaturesTick(silent);
    expect(await prisma.signatureScanState.findMany()).toEqual(states);

    // A third scan is new; deleting a scan takes its matches along.
    const third = await ingestScan();
    await signaturesTick(silent);
    expect(await matchesOf(signature.id)).toHaveLength(3);
    await prisma.scan.delete({ where: { id: third } });
    expect(await matchesOf(signature.id)).toHaveLength(2);
  });

  it("stores the evidence encrypted", async () => {
    await ingestScan();
    await createSignatureRow();
    await signaturesTick(silent);
    const match = await prisma.signatureMatch.findFirstOrThrow({
      where: { serviceId: await serviceIdOf("10.0.5.7", 443), signature: { key: null } },
    });
    expect(JSON.stringify(match.evidence)).not.toContain("PHP/8.1.2");
    expect(match.evidence).toHaveProperty("$enc");
  });
});
