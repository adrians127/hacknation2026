import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import { ImportTargetsResponseSchema } from "@subsurf/contracts/targets/targets.schema";

import { decryptText } from "~backend/lib/crypto";
import { prisma } from "~backend/lib/prisma";
import { resolveDomains } from "~backend/modules/scans/dns";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";

// No real DNS in tests: a fixed zone.
vi.mock("~backend/modules/scans/dns", () => ({ resolveDomains: vi.fn<typeof resolveDomains>() }));

const ZONE: Record<string, string[]> = {
  "app.example.com": ["198.51.100.7"],
  "www.example.com": ["198.51.100.7", "198.51.100.8"],
};

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  vi.mocked(resolveDomains).mockReset().mockImplementation(async (domains) => ({
    resolved: domains.flatMap((domain) => (ZONE[domain] ? [{ domain, addresses: ZONE[domain] }] : [])),
    warnings: domains
      .filter((domain) => !ZONE[domain])
      .map((value) => ({ code: "dns_not_found" as const, value })),
  }));
});

async function importAs(role: "admin" | "editor", body: unknown) {
  const { client } = await signInAs(server, { role });
  return client.post("/v1/targets/import", { body });
}

describe("POST /v1/targets/import", () => {
  it("adds targets and queues a scan split into jobs", async () => {
    const res = await importAs("editor", {
      entries: [
        { value: "10.0.0.0/22", note: " Campus " },
        { value: "10.0.0.5" },
        { value: "https://App.Example.com/login" },
        { value: "192.0.2.10" },
        { value: "10.0.0.9/22" },
      ],
      startScan: true,
    });

    expect(res.status).toBe(201);
    const body = ImportTargetsResponseSchema.parse(await res.json());
    // 10.0.0.9/22 normalizes to 10.0.0.0/22: a repeat, dropped.
    expect(body).toMatchObject({ received: 4, created: 4, skipped: 0, warnings: [] });
    expect(body.scan).toMatchObject({ status: "queued", targetCount: 4, addressCount: 1026, jobCount: 6 });

    const targets = (await prisma.target.findMany()).toSorted((a, b) => a.value.localeCompare(b.value));
    expect(targets.map((target) => [target.kind, target.value, decryptText(target.note)])).toEqual([
      ["cidr", "10.0.0.0/22", "Campus"],
      ["ip", "10.0.0.5", ""],
      ["ip", "192.0.2.10", ""],
      ["domain", "app.example.com", ""],
    ]);

    const jobs = await prisma.scanJob.findMany({ orderBy: { sequence: "asc" } });
    expect(jobs.map((job) => [job.sequence, job.subnet, job.targets, job.hosts, job.status, job.kind])).toEqual([
      [1, "10.0.0.0/24", ["10.0.0.0/24"], [], "queued", "discovery"],
      [2, "10.0.1.0/24", ["10.0.1.0/24"], [], "queued", "discovery"],
      [3, "10.0.2.0/24", ["10.0.2.0/24"], [], "queued", "discovery"],
      [4, "10.0.3.0/24", ["10.0.3.0/24"], [], "queued", "discovery"],
      [5, "192.0.2.10", ["192.0.2.10"], [], "queued", "discovery"],
      [6, "198.51.100.7", ["198.51.100.7"], [{ ip: "198.51.100.7", domain: "app.example.com" }], "queued", "discovery"],
    ]);
    expect(await prisma.scanTarget.count()).toBe(4);
    expect(await prisma.scan.findFirstOrThrow()).toMatchObject({ ports: expect.any(String), batchSize: 256 });
  });

  it("skips values already in the inventory but still scans them", async () => {
    await importAs("editor", { entries: [{ value: "192.0.2.10", note: "first" }], startScan: false });

    const res = await importAs("editor", {
      entries: [{ value: "192.0.2.10", note: "second" }, { value: "192.0.2.11" }],
      startScan: true,
    });

    const body = ImportTargetsResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ received: 2, created: 1, skipped: 1 });
    expect(body.scan).toMatchObject({ targetCount: 2, addressCount: 2, jobCount: 1 });
    const kept = await prisma.target.findUniqueOrThrow({ where: { value: "192.0.2.10" } });
    expect(decryptText(kept.note)).toBe("first");
  });

  it("tags the targets it creates and leaves existing ones alone", async () => {
    await importAs("editor", { entries: [{ value: "192.0.2.10" }], startScan: false, tags: ["old"] });

    const res = await importAs("editor", {
      entries: [{ value: "192.0.2.10" }, { value: "192.0.2.11" }],
      startScan: false,
      tags: ["campus", "dmz"],
    });

    expect(ImportTargetsResponseSchema.parse(await res.json())).toMatchObject({ created: 1, skipped: 1 });
    const targets = await prisma.target.findMany({
      orderBy: { value: "asc" },
      select: { value: true, tags: true },
    });
    expect(targets).toEqual([
      { value: "192.0.2.10", tags: ["old"] },
      { value: "192.0.2.11", tags: ["campus", "dmz"] },
    ]);
  });

  it("stores an IP range as the CIDR blocks that cover it", async () => {
    const res = await importAs("editor", {
      entries: [{ value: "192.0.2.0-192.0.2.129", note: "Lab" }],
      startScan: true,
    });

    expect(ImportTargetsResponseSchema.parse(await res.json())).toMatchObject({
      received: 2,
      created: 2,
      scan: { targetCount: 2, addressCount: 130 },
    });
    const targets = await prisma.target.findMany({
      orderBy: { value: "asc" },
      select: { kind: true, value: true, note: true },
    });
    expect(targets.map((target) => ({ ...target, note: decryptText(target.note) }))).toEqual([
      { kind: "cidr", value: "192.0.2.0/25", note: "Lab" },
      { kind: "cidr", value: "192.0.2.128/31", note: "Lab" },
    ]);
  });

  it("only stores targets without startScan", async () => {
    const res = await importAs("editor", { entries: [{ value: "app.example.com" }], startScan: false });

    expect(ImportTargetsResponseSchema.parse(await res.json())).toMatchObject({ created: 1, scan: null });
    expect(resolveDomains).not.toHaveBeenCalled();
    expect(await prisma.scan.count()).toBe(0);
  });

  it("reports domains that cannot be scanned", async () => {
    const res = await importAs("editor", {
      entries: [{ value: "www.example.com" }, { value: "missing.example.com" }],
      startScan: true,
    });

    const body = ImportTargetsResponseSchema.parse(await res.json());
    expect(body.warnings).toEqual([{ code: "dns_not_found", value: "missing.example.com" }]);
    expect(body.scan).toMatchObject({ targetCount: 2, addressCount: 2, jobCount: 1 });
    const [job] = await prisma.scanJob.findMany();
    expect(job?.hosts).toEqual([
      { ip: "198.51.100.7", domain: "www.example.com" },
      { ip: "198.51.100.8", domain: "www.example.com" },
    ]);
  });

  it("queues no scan when nothing is scannable, but keeps the targets", async () => {
    const res = await importAs("editor", { entries: [{ value: "missing.example.com" }], startScan: true });

    const body = ImportTargetsResponseSchema.parse(await res.json());
    expect(body.scan).toBeNull();
    expect(body.warnings).toEqual([
      { code: "dns_not_found", value: "missing.example.com" },
      { code: "no_scannable_targets", value: "" },
    ]);
    expect(await prisma.target.count()).toBe(1);
    expect(await prisma.scan.count()).toBe(0);
  });

  it.each([
    ["IPv6", "2001:db8::1"],
    ["a CIDR larger than /16", "10.0.0.0/15"],
    ["an IP range larger than a /16", "10.0.0.0-10.1.0.0"],
    ["a reserved range", "127.0.0.1"],
    ["garbage", "not a target"],
  ])("rejects %s", async (_name, value) => {
    const res = await importAs("admin", { entries: [{ value: "192.0.2.1" }, { value }], startScan: false });

    expect(res.status).toBe(400);
    expect(await prisma.target.count()).toBe(0);
  });

  it("accepts a body larger than the global 1 MB limit", async () => {
    const entries = Array.from({ length: 60_000 }, (_, index) => ({
      value: `10.${Math.floor(index / 65_536)}.${Math.floor(index / 256) % 256}.${index % 256}`,
      note: "bulk",
    }));
    expect(JSON.stringify({ entries }).length).toBeGreaterThan(1024 * 1024);

    const res = await importAs("admin", { entries, startScan: true });

    expect(res.status).toBe(201);
    const body = ImportTargetsResponseSchema.parse(await res.json());
    expect(body).toMatchObject({ received: 60_000, created: 60_000 });
    // 60,000 consecutive addresses in 10.0.0.0/16: 234 full /24 batches and one of 96.
    expect(body.scan).toMatchObject({ addressCount: 60_000, jobCount: 235 });
    expect(await prisma.scanTarget.count()).toBe(60_000);
  }, 60_000);

  it("requires scans:run to queue a scan", async () => {
    const role = await prisma.role.create({ data: { name: "Importer", permissions: ["targets:create"] } });
    const { client } = await signInAs(server, { roleId: role.id });

    const withScan = await client.post("/v1/targets/import", {
      body: { entries: [{ value: "192.0.2.1" }], startScan: true },
    });
    expect(withScan.status).toBe(403);
    expect(ErrorResponseSchema.parse(await withScan.json()).error.code).toBe("FORBIDDEN");
    expect(await prisma.target.count()).toBe(0);

    const withoutScan = await client.post("/v1/targets/import", {
      body: { entries: [{ value: "192.0.2.1" }], startScan: false },
    });
    expect(withoutScan.status).toBe(201);
  });
});
