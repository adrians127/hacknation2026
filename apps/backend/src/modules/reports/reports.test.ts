import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import {
  DiffReportSchema,
  ExposureReportSchema,
  FindingsReportSchema,
  IpReportSchema,
  ScanSummaryReportSchema,
  StabilityReportSchema,
  TagsReportSchema,
  TechnologiesReportSchema,
  TimeOfDayReportSchema,
  TriageReportSchema,
} from "@subsurf/contracts/reports/reports.schema";
import type { ObservedHost } from "@subsurf/contracts/workers/worker-result.schema";

import { prisma } from "~backend/lib/prisma";
import { createUser, signIn, signInAs } from "~backend/test/auth";
import { startTestServer, type TestClient, type TestServer } from "~backend/test/http";
import { databaseHost, hostIdOf, ingestScan, serviceIdOf } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const withDatabaseHost = (hosts: ObservedHost[]) => [...hosts, databaseHost(hosts)];

/** The wiki's SSH is upgraded and it opens 8080, the database host goes down, 10.0.5.8 comes up. */
function secondScan(hosts: ObservedHost[]): ObservedHost[] {
  const [wiki, down, ...rest] = hosts;
  const [ssh, https] = wiki.ports;
  if (!ssh.service) throw new Error("The example's SSH port has a service");
  return [
    { ...wiki, ports: [{ ...ssh, service: { ...ssh.service, version: "9.7p1" } }, https, { ...ssh, port: 8080, service: null, banner: null }] },
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
  expect({ path, status: res.status }).toEqual({ path, status: 200 });
  return res.json();
}

async function viewer() {
  return (await signInAs(server, { role: "viewer" })).client;
}

describe("reports: access", () => {
  it("needs a session and scans:read", async () => {
    const scanId = await ingestScan();
    expect((await fetch(`${server.baseUrl}/v1/reports/scans/${scanId}/summary`)).status).toBe(401);

    const role = await prisma.role.create({ data: { name: "No scans", permissions: ["targets:read"] } });
    const user = await createUser({ roleId: role.id });
    const client = await signIn(server, user.email);
    for (const path of [
      `/v1/reports/scans/${scanId}/summary`,
      `/v1/reports/scans/${scanId}/findings`,
      `/v1/reports/ips/10.0.5.7`,
      `/v1/reports/stability`,
      `/v1/reports/time-of-day`,
    ]) {
      expect({ path, status: (await client.get(path)).status }).toEqual({ path, status: 403 });
    }
  });

  it("answers 404 for an unknown scan or address and 400 for a malformed one", async () => {
    await ingestScan();
    const client = await viewer();
    expect((await client.get("/v1/reports/scans/0193f0d0-0000-7000-8000-00000000ffff/findings")).status).toBe(404);
    expect((await client.get("/v1/reports/ips/10.9.9.9")).status).toBe(404);
    expect((await client.get("/v1/reports/ips/not-an-ip")).status).toBe(400);
  });
});

describe("GET /reports/scans/{id}/summary", () => {
  it("sums up execution, changes, findings, ports and technologies", async () => {
    const { second } = await twoScans();
    const report = ScanSummaryReportSchema.parse(await getJson(await viewer(), `/v1/reports/scans/${second}/summary`));

    expect(report.scan.id).toBe(second);
    expect(report.execution).toMatchObject({ results: 1, partialResults: 1 });
    expect(report.changes?.newHosts.map((host) => host.ip)).toEqual(["10.0.5.8"]);
    expect(report.changes?.goneHosts).toEqual([expect.objectContaining({ ip: "10.0.5.20", ports: [3306] })]);
    expect(report.changes?.changedServices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ip: "10.0.5.7", port: 22, change: "changed" }),
        expect.objectContaining({ ip: "10.0.5.7", port: 8080, change: "new" }),
      ]),
    );
    expect(report.topPorts[0]).toEqual({ port: 22, hosts: 2 });
    expect(report.topTechnologies.map((technology) => technology.name)).toEqual(expect.arrayContaining(["OpenSSH", "nginx"]));
    expect(report.findings.medium).toBeGreaterThan(0);
  });

  it("has no changes for the first scan", async () => {
    const first = await ingestScan();
    const report = ScanSummaryReportSchema.parse(await getJson(await viewer(), `/v1/reports/scans/${first}/summary`));
    expect(report.changes).toBeNull();
  });
});

describe("GET /reports/scans/{id}/findings", () => {
  it("ranks hosts by priority and leaves out false positives", async () => {
    const first = await ingestScan(withDatabaseHost);
    const client = await viewer();
    const report = FindingsReportSchema.parse(await getJson(client, `/v1/reports/scans/${first}/findings`));

    const database = report.hosts.find((host) => host.ip === "10.0.5.20");
    expect(database?.findings).toEqual([expect.objectContaining({ rule: "database-exposed", severity: "high", port: 3306 })]);
    const wiki = report.hosts.find((host) => host.ip === "10.0.5.7");
    expect(wiki?.findings.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["outdated-software", "cookie-insecure", "version-disclosure"]),
    );
    expect(report.byRule.find((entry) => entry.rule === "database-exposed")).toEqual({
      rule: "database-exposed",
      severity: "high",
      count: 1,
    });

    await prisma.host.update({ where: { ip: "10.0.5.20" }, data: { triage: "false_positive" } });
    const after = FindingsReportSchema.parse(await getJson(client, `/v1/reports/scans/${first}/findings`));
    expect(after.hosts.map((host) => host.ip)).not.toContain("10.0.5.20");
  });
});

describe("GET /reports/scans/{id}/technologies and /exposure", () => {
  it("lists what runs where and how many hosts expose each port", async () => {
    const { second } = await twoScans();
    const client = await viewer();
    const tech = TechnologiesReportSchema.parse(await getJson(client, `/v1/reports/scans/${second}/technologies`));
    const names = new Map(tech.technologies.map((technology) => [technology.name, technology]));
    expect(names.get("OpenSSH")).toMatchObject({ category: "service", hosts: 2 });
    expect(names.get("PHP")).toMatchObject({ category: "language", versions: [{ version: "8.1.2", services: 1 }] });
    expect(names.get("WordPress")?.category).toBe("cms");

    const exposure = ExposureReportSchema.parse(await getJson(client, `/v1/reports/scans/${second}/exposure`));
    expect(exposure.totals).toEqual({ hostsUp: 2, openPorts: 4, distinctPorts: 3 });
    expect(exposure.ports[0]).toMatchObject({ port: 22, hosts: 2, newHosts: 1 });
    expect(exposure.subnets).toEqual([{ cidr: "10.0.5.0/24", hostsUp: 2, openPorts: 4, topPorts: [22, 443, 8080] }]);
  });
});

describe("GET /reports/scans/{id}/triage and /tags", () => {
  it("shows verdicts, new unreviewed services and tagged hosts", async () => {
    const { second } = await twoScans();
    const client = await viewer();
    const https = await serviceIdOf("10.0.5.7", 443);
    await prisma.service.update({ where: { id: https }, data: { triage: "important", tags: ["web"] } });
    await prisma.host.update({ where: { ip: "10.0.5.8" }, data: { tags: ["lab"] } });

    const triage = TriageReportSchema.parse(await getJson(client, `/v1/reports/scans/${second}/triage`));
    expect(triage.services).toMatchObject({ important: 1, unreviewed: 3 });
    expect(triage.progress).toBe(0.25);
    expect(triage.important.map((item) => item.serviceId)).toEqual([https]);
    expect(triage.newUnreviewed.map((item) => `${item.ip}:${item.port}`).toSorted()).toEqual(["10.0.5.7:8080", "10.0.5.8:22"]);

    const tags = TagsReportSchema.parse(await getJson(client, `/v1/reports/scans/${second}/tags`));
    expect(tags.tags.map((tag) => tag.tag).toSorted()).toEqual(["lab", "web"]);
    expect(tags.selected).toBeNull();
    const lab = TagsReportSchema.parse(await getJson(client, `/v1/reports/scans/${second}/tags?tag=lab`));
    expect(lab.selected).toMatchObject({
      tag: "lab",
      changes: { hosts: { new: 1, gone: 0, changed: 0, unknown: 0 } },
      hosts: [expect.objectContaining({ ip: "10.0.5.8", change: "new" })],
    });
  });
});

describe("GET /reports/diff", () => {
  it("compares any two scans, in either direction", async () => {
    const { first, second } = await twoScans();
    const client = await viewer();
    const forward = DiffReportSchema.parse(await getJson(client, `/v1/reports/diff?from=${first}&to=${second}`));

    expect(forward.from.id).toBe(first);
    expect(forward.counts).toEqual({
      hosts: { new: 1, gone: 1, changed: 1, unknown: 0 },
      services: { new: 2, gone: 1, changed: 1 },
    });
    const wiki = forward.hosts.find((host) => host.ip === "10.0.5.7");
    expect(wiki?.services).toEqual([
      expect.objectContaining({
        port: 22,
        change: "changed",
        fields: ["version"],
        before: expect.objectContaining({ identity: expect.objectContaining({ version: "9.6p1" }) }),
        after: expect.objectContaining({ identity: expect.objectContaining({ version: "9.7p1" }) }),
      }),
      expect.objectContaining({ port: 8080, change: "new", before: null }),
    ]);

    const backward = DiffReportSchema.parse(await getJson(client, `/v1/reports/diff?from=${second}&to=${first}`));
    expect(backward.hosts.find((host) => host.ip === "10.0.5.20")?.change).toBe("new");
    expect(backward.hosts.find((host) => host.ip === "10.0.5.8")?.change).toBe("gone");
  });

  it("rejects the same scan twice", async () => {
    const scanId = await ingestScan();
    const res = await (await viewer()).get(`/v1/reports/diff?from=${scanId}&to=${scanId}`);
    expect(res.status).toBe(400);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("SAME_SCAN");
  });
});

describe("GET /reports/ips/{ip}", () => {
  it("follows one address and its services across scans", async () => {
    const { first, second } = await twoScans();
    await prisma.host.update({ where: { ip: "10.0.5.7" }, data: { tags: ["wiki"] } });
    const report = IpReportSchema.parse(await getJson(await viewer(), "/v1/reports/ips/10.0.5.7"));

    expect(report.host).toMatchObject({ id: await hostIdOf("10.0.5.7"), tags: ["wiki"] });
    expect(report.stats).toMatchObject({ scans: 2, up: 2, availability: 1, transitions: 0, lastStatus: "up" });
    expect(report.timeline).toEqual([
      expect.objectContaining({ scanId: first, openPorts: [22, 443], opened: [], changed: [] }),
      expect.objectContaining({ scanId: second, openPorts: [22, 443, 8080], opened: [8080], closed: [], changed: [22] }),
    ]);
    const ssh = report.services.find((service) => service.port === 22);
    expect(ssh?.states.map((state) => state.snapshot.identity.version)).toEqual(["9.6p1", "9.7p1"]);
    expect(report.technologies.map((technology) => technology.name)).toEqual(expect.arrayContaining(["OpenSSH", "nginx", "PHP"]));
  });

  it("reports an address that went down", async () => {
    await twoScans();
    const report = IpReportSchema.parse(await getJson(await viewer(), "/v1/reports/ips/10.0.5.20"));
    expect(report.stats).toMatchObject({ scans: 2, up: 1, availability: 0.5, transitions: 1, lastStatus: "down" });
    expect(report.services).toEqual([expect.objectContaining({ port: 3306, isOpen: false, seenInScans: 1 })]);
    expect(report.findings.map((finding) => finding.rule)).toContain("database-exposed");
  });
});

describe("GET /reports/stability", () => {
  it("finds flapping and unresponsive hosts in the window", async () => {
    await ingestScan(withDatabaseHost);
    await ingestScan(secondScan);
    const third = await ingestScan((hosts) => {
      const [wiki, ...rest] = withDatabaseHost(hosts);
      return [{ ...wiki, status: "timeout", reason: null, ports: [], hostnames: [] }, ...rest];
    });
    const report = StabilityReportSchema.parse(await getJson(await viewer(), `/v1/reports/stability?scanId=${third}`));

    expect(report.scans).toHaveLength(3);
    const byIp = new Map(report.hosts.map((host) => [host.ip, host]));
    expect(byIp.get("10.0.5.20")).toMatchObject({ class: "flapping", history: ["up", "down", "up"], transitions: 2, recheck: true });
    expect(byIp.get("10.0.5.7")).toMatchObject({ class: "unresponsive", sinceLastUp: 1 });
    expect(byIp.has("10.0.5.9")).toBe(false);
    expect(byIp.get("10.0.5.8")).toMatchObject({ class: "flapping", history: ["down", "up", "down"] });
    expect(report.counts).toMatchObject({ flapping: 2, unresponsive: 1 });
  });
});

describe("GET /reports/time-of-day", () => {
  it("needs scans from two periods, then shows hosts that depend on the period", async () => {
    const night = await ingestScan(withDatabaseHost);
    const client = await viewer();
    const single = TimeOfDayReportSchema.parse(await getJson(client, "/v1/reports/time-of-day"));
    expect(single).toMatchObject({ comparable: false, hosts: [] });

    const afternoon = await ingestScan(secondScan);
    await prisma.scan.update({ where: { id: night }, data: { startedAt: new Date("2026-11-20T02:00:00Z") } });
    await prisma.scan.update({ where: { id: afternoon }, data: { startedAt: new Date("2026-11-20T14:00:00Z") } });
    const report = TimeOfDayReportSchema.parse(await getJson(client, "/v1/reports/time-of-day?utcOffsetMinutes=60"));

    expect(report.comparable).toBe(true);
    expect(report.periods).toEqual([
      { period: "night", scans: 1 },
      { period: "morning", scans: 0 },
      { period: "afternoon", scans: 1 },
      { period: "evening", scans: 0 },
    ]);
    const database = report.hosts.find((host) => host.ip === "10.0.5.20");
    expect(database).toMatchObject({ upIn: ["night"], downIn: ["afternoon"] });
    expect(report.hosts.find((host) => host.ip === "10.0.5.7")?.periodPorts).toEqual([8080]);
  });
});
