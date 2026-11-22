import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DashboardResponseSchema } from "@subsurf/contracts/dashboard/dashboard.schema";
import {
  RuleListResponseSchema,
  RulePreviewResponseSchema,
  RuleSchema,
  type RuleDefinition,
} from "@subsurf/contracts/rules/rules.schema";
import { ScanChangesResponseSchema } from "@subsurf/contracts/scans/scan-changes.schema";
import { ScanHostListResponseSchema } from "@subsurf/contracts/scans/scan-results.schema";
import type { ObservedHost } from "@subsurf/contracts/workers/worker-result.schema";

import { prisma } from "~backend/lib/prisma";
import { rulesTick } from "~backend/modules/rules/rules.scheduler";
import { definition } from "~backend/modules/rules/test/rules";
import { serviceWithMatch } from "~backend/modules/vulnerabilities/test/matches";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestClient, type TestServer } from "~backend/test/http";
import { hostIdOf, ingestScan, serviceIdOf } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

const silent = pino({ level: "silent" });

async function createRule(client: TestClient, ruleDefinition: RuleDefinition, extra = {}) {
  const res = await client.post("/v1/rules", {
    body: { name: `Rule ${ruleDefinition.kind}`, definition: ruleDefinition, ...extra },
  });
  expect(res.status).toBe(201);
  return RuleSchema.parse(await res.json());
}

const vulnerabilityTriage = (serviceId: string, canonicalId: string) =>
  prisma.serviceVulnerabilityTriage.findUnique({
    where: { serviceId_canonicalId: { serviceId, canonicalId } },
    select: { triage: true, triageRuleId: true },
  });

const serviceTriage = (id: string) =>
  prisma.service.findUniqueOrThrow({
    where: { id },
    select: { triage: true, triageRuleId: true, tags: true },
  });

const hostTags = async () =>
  (await prisma.host.findUniqueOrThrow({ where: { ip: "10.0.5.7" } })).tags;

/** The example's HTTPS page with another title: a changed service. */
const retitled = (hosts: ObservedHost[]) =>
  hosts.map((host) => ({
    ...host,
    ports: host.ports.map((port) =>
      port.port === 443
        ? { ...port, http: port.http.map((endpoint) => ({ ...endpoint, title: "Wiki – maintenance" })) }
        : port,
    ),
  }));

describe("rules CRUD", () => {
  it("creates, lists, moves, disables and deletes rules", async () => {
    const { client, user } = await signInAs(server, { role: "editor" });
    const first = await createRule(client, definition("service"), { note: "Why it exists" });
    const second = await createRule(client, definition("unchanged"));
    expect(first).toMatchObject({ position: 0, note: "Why it exists", enabled: true, expired: false });
    expect(first.createdBy?.id).toBe(user.id);
    expect(second.position).toBe(1);

    const moved = await client.patch(`/v1/rules/${second.id}`, { body: { position: 0 } });
    expect(moved.status).toBe(200);
    const list = RuleListResponseSchema.parse(await (await client.get("/v1/rules")).json());
    expect(list.items.map((rule) => [rule.id, rule.position])).toEqual([
      [second.id, 0],
      [first.id, 1],
    ]);
    const stored = await prisma.rule.findUniqueOrThrow({ where: { id: first.id } });
    expect(JSON.stringify(stored.note)).not.toContain("Why it exists");

    expect((await client.delete(`/v1/rules/${second.id}`)).status).toBe(204);
    expect((await client.delete(`/v1/rules/${second.id}`)).status).toBe(404);
    const after = RuleListResponseSchema.parse(await (await client.get("/v1/rules")).json());
    expect(after.items.map((rule) => [rule.id, rule.position])).toEqual([[first.id, 0]]);
  });

  it("rejects a definition that does not validate", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const badRange = await client.post("/v1/rules", {
      body: { name: "Bad", definition: definition("service", { scope: { ranges: ["10.0.0.0/33"] } }) },
    });
    expect(badRange.status).toBe(400);
    const nothingToDo = await client.post("/v1/rules", {
      body: { name: "Bad", definition: definition("service", { action: { triage: null, tag: null } }) },
    });
    expect(nothingToDo.status).toBe(400);
  });
});

describe("vulnerability rules", () => {
  it("ignores matching vulnerabilities, never a user's verdict, and reverts when disabled", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const ignored = await serviceWithMatch("CVE-2023-48795");
    const userSet = await serviceWithMatch("CVE-2023-48795");
    const other = await serviceWithMatch("CVE-2024-6387");
    await client.patch(
      `/v1/vulnerabilities/services/${userSet.serviceId}/${userSet.canonicalId}`,
      { body: { triage: "important" } },
    );

    const rule = await createRule(
      client,
      definition("vulnerability", {
        condition: { vulnerabilityIds: ["cve-2023-48795"] },
        action: { triage: "accepted_risk" },
      }),
    );
    expect(await vulnerabilityTriage(ignored.serviceId, ignored.canonicalId)).toEqual({
      triage: "accepted_risk",
      triageRuleId: rule.id,
    });
    expect(await vulnerabilityTriage(userSet.serviceId, userSet.canonicalId)).toEqual({
      triage: "important",
      triageRuleId: null,
    });
    expect(await vulnerabilityTriage(other.serviceId, other.canonicalId)).toBeNull();
    const listed = RuleListResponseSchema.parse(await (await client.get("/v1/rules")).json());
    expect(listed.items[0]?.affected).toEqual({ hosts: 0, services: 0, vulnerabilities: 1, tags: 0 });

    await client.patch(`/v1/rules/${rule.id}`, { body: { enabled: false } });
    expect(await vulnerabilityTriage(ignored.serviceId, ignored.canonicalId)).toEqual({
      triage: "unreviewed",
      triageRuleId: null,
    });
  });

  it("lets a user take a value over from a rule", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const match = await serviceWithMatch("CVE-2023-48795");
    const rule = await createRule(client, definition("vulnerability"));
    expect((await vulnerabilityTriage(match.serviceId, match.canonicalId))?.triageRuleId).toBe(rule.id);

    await client.patch(`/v1/vulnerabilities/services/${match.serviceId}/${match.canonicalId}`, {
      body: { triage: "false_positive" },
    });
    expect((await client.delete(`/v1/rules/${rule.id}`)).status).toBe(204);
    expect(await vulnerabilityTriage(match.serviceId, match.canonicalId)).toEqual({
      triage: "false_positive",
      triageRuleId: null,
    });
  });

  it("reverts what an expired rule set on the scheduler's next pass", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const match = await serviceWithMatch("CVE-2023-48795");
    const expiresAt = new Date(Date.now() + 60 * 60_000);
    await createRule(client, definition("vulnerability"), { expiresAt: expiresAt.toISOString() });
    expect((await vulnerabilityTriage(match.serviceId, match.canonicalId))?.triage).toBe("false_positive");

    await rulesTick(silent, new Date(expiresAt.getTime() + 60_000));
    expect(await vulnerabilityTriage(match.serviceId, match.canonicalId)).toEqual({
      triage: "unreviewed",
      triageRuleId: null,
    });
  });
});

describe("service rules", () => {
  it("sets the triage and a tag of matching services, shown in the scan view", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const scanId = await ingestScan();
    const https = await serviceIdOf("10.0.5.7", 443);
    const ssh = await serviceIdOf("10.0.5.7", 22);
    const rule = await createRule(
      client,
      definition("service", {
        scope: { products: ["nginx"] },
        condition: { titles: ["login"] },
        action: { triage: "important", tag: "web" },
      }),
    );
    expect(await serviceTriage(https)).toEqual({ triage: "important", triageRuleId: rule.id, tags: ["web"] });
    expect(await serviceTriage(ssh)).toEqual({ triage: "unreviewed", triageRuleId: null, tags: [] });

    const hosts = ScanHostListResponseSchema.parse(
      await (await client.get(`/v1/scans/${scanId}/hosts`)).json(),
    );
    const shown = hosts.items[0]?.services.find((service) => service.port === 443);
    expect(shown?.triageRule).toEqual({ id: rule.id, name: rule.name });

    // A tag the user removes stays removed; deleting the rule reverts the triage.
    const hostId = await hostIdOf("10.0.5.7");
    await client.patch(`/v1/hosts/${hostId}/services/${https}`, { body: { tags: [] } });
    await client.patch(`/v1/rules/${rule.id}`, { body: { name: "Renamed" } });
    expect((await serviceTriage(https)).tags).toEqual([]);
    await client.delete(`/v1/rules/${rule.id}`);
    expect(await serviceTriage(https)).toEqual({ triage: "unreviewed", triageRuleId: null, tags: [] });
    expect(await prisma.ruleTag.count()).toBe(0);
  });

  it("tags hosts through one of their ports and removes the tag with the rule", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    await ingestScan();
    const rule = await createRule(
      client,
      definition("service", {
        scope: { ports: [22] },
        condition: { target: "host" },
        action: { triage: null, tag: "ssh" },
      }),
    );
    expect(await hostTags()).toEqual(["ssh"]);
    await client.delete(`/v1/rules/${rule.id}`);
    expect(await hostTags()).toEqual([]);
  });
});

describe("unchanged rules", () => {
  it("marks unchanged services reviewed and sends a changed one back to unreviewed", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    await ingestScan();
    const rule = await createRule(client, definition("unchanged"));
    const https = await serviceIdOf("10.0.5.7", 443);
    const ssh = await serviceIdOf("10.0.5.7", 22);
    // One scan: nothing to compare with yet.
    expect((await serviceTriage(https)).triage).toBe("unreviewed");

    await ingestScan();
    await rulesTick(silent, new Date(Date.now() + 2 * 60_000));
    expect(await serviceTriage(https)).toMatchObject({ triage: "reviewed", triageRuleId: rule.id });
    expect(await serviceTriage(ssh)).toMatchObject({ triage: "reviewed", triageRuleId: rule.id });

    await ingestScan(retitled);
    await rulesTick(silent, new Date(Date.now() + 4 * 60_000));
    expect(await serviceTriage(https)).toMatchObject({ triage: "unreviewed", triageRuleId: null });
    expect(await serviceTriage(ssh)).toMatchObject({ triage: "reviewed", triageRuleId: rule.id });
  });
});

describe("change priority rules", () => {
  it("mutes and re-rates changes in the export and the dashboard", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    await ingestScan();
    const scanId = await ingestScan(retitled);
    const changes = async () =>
      ScanChangesResponseSchema.parse(await (await client.get(`/v1/scans/${scanId}/changes`)).json())
        .items.filter((row) => row.field === "http.title");
    const [builtIn] = await changes();
    expect(builtIn).toMatchObject({ muted: false, rule: null });

    const mute = await createRule(
      client,
      definition("change_priority", { condition: { fields: ["http.title"] } }),
    );
    expect((await changes())[0]).toMatchObject({ muted: true, rule: { id: mute.id }, priority: builtIn?.priority });
    const dashboard = DashboardResponseSchema.parse(await (await client.get("/v1/dashboard")).json());
    expect(dashboard.muted).toBeGreaterThan(0);
    expect(dashboard.topChanges.flatMap((change) => change.fields.map((field) => field.field))).not.toContain(
      "http.title",
    );

    const raise = await createRule(
      client,
      definition("change_priority", { scope: { ports: [443] }, action: { type: "priority", priority: "high" } }),
    );
    await client.patch(`/v1/rules/${raise.id}`, { body: { position: 0 } });
    expect((await changes())[0]).toMatchObject({ muted: false, priority: "high", rule: { id: raise.id } });
    const csv = await (await client.get(`/v1/scans/${scanId}/changes?format=csv`)).text();
    expect(csv.split("\r\n")[0]).toMatch(/,lifecycle,rule,muted$/);
    expect(csv).toContain(raise.name);
  });
});

describe("POST /rules/preview", () => {
  it("counts what a rule would change, already holds or must leave to a user", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    const first = await serviceWithMatch("CVE-2023-48795");
    const second = await serviceWithMatch("CVE-2023-48795");
    await client.patch(`/v1/vulnerabilities/services/${second.serviceId}/${second.canonicalId}`, {
      body: { triage: "important" },
    });
    const ruleDefinition = definition("vulnerability", {
      condition: { vulnerabilityIds: ["CVE-2023-48795"] },
    });
    const preview = async (body: object) =>
      RulePreviewResponseSchema.parse(await (await client.post("/v1/rules/preview", { body })).json());

    const before = await preview({ definition: ruleDefinition });
    expect(before).toMatchObject({ matched: 2, changes: 1, unchanged: 0, skipped: 1 });
    expect(before.samples[0]).toMatchObject({
      serviceId: first.serviceId,
      vulnerabilityId: "CVE-2023-48795",
      triage: { before: "unreviewed", after: "false_positive" },
    });
    expect(await prisma.serviceVulnerabilityTriage.count({ where: { triageRuleId: { not: null } } })).toBe(0);

    const rule = await createRule(client, ruleDefinition);
    expect(await preview({ definition: ruleDefinition, ruleId: rule.id })).toMatchObject({
      matched: 2,
      changes: 0,
      unchanged: 1,
      skipped: 1,
    });
  });

  it("previews change rules on the newest scan", async () => {
    const { client } = await signInAs(server, { role: "editor" });
    await ingestScan();
    const scanId = await ingestScan(retitled);
    const res = await client.post("/v1/rules/preview", {
      body: { definition: definition("change_priority", { condition: { fields: ["http.title"] } }) },
    });
    const preview = RulePreviewResponseSchema.parse(await res.json());
    expect(preview.scan?.id).toBe(scanId);
    expect(preview.matched).toBeGreaterThan(0);
    expect(preview.changes).toBe(preview.matched);
    expect(preview.samples[0]?.priority?.after).toBe("muted");
  });
});
