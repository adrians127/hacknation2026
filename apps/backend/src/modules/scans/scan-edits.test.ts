import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import { ScanDetailSchema } from "@subsurf/contracts/scans/scan-results.schema";
import { ScanListResponseSchema, UpdatedScanSchema } from "@subsurf/contracts/scans/scans.schema";

import { prisma } from "~backend/lib/prisma";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";
import { hostIdOf, ingestScan } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

describe("PATCH /scans/{id}", () => {
  it("names and annotates a scan, with the note encrypted at rest", async () => {
    const scanId = await ingestScan();
    const { client } = await signInAs(server, { role: "analyst" });

    const res = await client.patch(`/v1/scans/${scanId}`, {
      body: { name: "  Lab, before the firewall change ", note: "Baseline for the comparison" },
    });

    expect(res.status).toBe(200);
    expect(UpdatedScanSchema.parse(await res.json())).toEqual({
      id: scanId,
      name: "Lab, before the firewall change",
      note: "Baseline for the comparison",
    });
    const detail = ScanDetailSchema.parse(await (await client.get(`/v1/scans/${scanId}`)).json());
    expect(detail).toMatchObject({
      name: "Lab, before the firewall change",
      note: "Baseline for the comparison",
    });
    const { items } = ScanListResponseSchema.parse(await (await client.get("/v1/scans")).json());
    expect(items[0].name).toBe("Lab, before the firewall change");
    const stored = await prisma.scan.findUniqueOrThrow({ where: { id: scanId }, select: { note: true } });
    expect(JSON.stringify(stored)).toContain('"$enc"');
    expect(JSON.stringify(stored)).not.toContain("Baseline");
  });

  it("changes only the fields given, and an empty note is no note", async () => {
    const scanId = await ingestScan();
    const { client } = await signInAs(server, { role: "editor" });
    await client.patch(`/v1/scans/${scanId}`, { body: { name: "Named", note: "Noted" } });

    const res = await client.patch(`/v1/scans/${scanId}`, { body: { note: "" } });

    expect(UpdatedScanSchema.parse(await res.json())).toMatchObject({ name: "Named", note: "" });
    expect((await prisma.scan.findUniqueOrThrow({ where: { id: scanId } })).note).toBeNull();
  });

  it("rejects invalid input, unknown scans and roles that may not update", async () => {
    const scanId = await ingestScan();
    const { client } = await signInAs(server, { role: "editor" });
    const { client: viewer } = await signInAs(server, { role: "viewer" });

    expect((await client.patch(`/v1/scans/${scanId}`, { body: {} })).status).toBe(400);
    expect((await client.patch(`/v1/scans/${scanId}`, { body: { name: "x".repeat(201) } })).status).toBe(400);
    expect((await client.patch(`/v1/scans/${scanId}`, { body: { ports: "1-65535" } })).status).toBe(400);
    expect((await client.patch(`/v1/scans/${randomUUID()}`, { body: { name: "x" } })).status).toBe(404);
    expect((await viewer.patch(`/v1/scans/${scanId}`, { body: { name: "x" } })).status).toBe(403);
  });
});

describe("DELETE /scans/{id}", () => {
  it("deletes the scan with its observations and keeps the hosts and their edits", async () => {
    const first = await ingestScan();
    const second = await ingestScan();
    const { client } = await signInAs(server, { role: "editor" });
    await client.patch(`/v1/hosts/${await hostIdOf("10.0.5.7")}`, { body: { note: "Keep me", tags: ["dmz"] } });

    const res = await client.delete(`/v1/scans/${second}`);

    expect(res.status).toBe(204);
    expect((await client.get(`/v1/scans/${second}`)).status).toBe(404);
    expect(await prisma.scanJob.count({ where: { scanId: second } })).toBe(0);
    expect(await prisma.scanJobResult.count({ where: { scanId: second } })).toBe(0);
    expect(await prisma.hostObservation.count({ where: { scanId: second } })).toBe(0);
    expect(await prisma.portObservation.count()).toBe(2);
    // The other scan is untouched, and so is what the analyst wrote on the host.
    expect(await prisma.hostObservation.count({ where: { scanId: first } })).toBe(4);
    const host = await prisma.host.findUniqueOrThrow({ where: { ip: "10.0.5.7" } });
    expect(host.tags).toEqual(["dmz"]);
    expect(await prisma.service.count()).toBe(2);
    // The vuln-sync process is asked to look at the services again.
    expect(await prisma.vulnerabilityJobRequest.count({ where: { kind: "rematch" } })).toBe(1);
  });

  it("refuses a running scan, an unknown one and roles that may not delete", async () => {
    const scanId = await ingestScan();
    const { client } = await signInAs(server, { role: "editor" });
    const { client: analyst } = await signInAs(server, { role: "analyst" });
    await prisma.scan.update({ where: { id: scanId }, data: { status: "running" } });

    const running = await client.delete(`/v1/scans/${scanId}`);

    expect(running.status).toBe(409);
    expect(ErrorResponseSchema.parse(await running.json()).error.code).toBe("SCAN_RUNNING");
    expect((await analyst.delete(`/v1/scans/${scanId}`)).status).toBe(403);
    expect((await client.delete(`/v1/scans/${randomUUID()}`)).status).toBe(404);
    expect(await prisma.scan.count()).toBe(1);
  });
});
