import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ErrorResponseSchema } from "@subsurf/contracts/common/common.schema";
import {
  DefectDojoPushSchema,
  DefectDojoStatusSchema,
  DefectDojoSyncSchema,
} from "@subsurf/contracts/defectdojo/defectdojo.schema";
import { ScanHostListResponseSchema } from "@subsurf/contracts/scans/scan-results.schema";

import { prisma } from "~backend/lib/prisma";
import type { DojoFinding } from "~backend/modules/defectdojo/defectdojo.client";
import {
  findingAddresses,
  mergeTags,
  remediationFromFindings,
  triageFromFindings,
} from "~backend/modules/defectdojo/defectdojo.import";
import { signInAs } from "~backend/test/auth";
import { startTestServer, type TestServer } from "~backend/test/http";
import { hostIdOf, ingestScan, serviceIdOf } from "~backend/test/scans";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer();
});

afterAll(async () => {
  await server.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

type RawFinding = Omit<DojoFinding, "locations">;

function finding(overrides: Partial<RawFinding> & { id: number }): RawFinding {
  return {
    description: null,
    unique_id_from_tool: null,
    endpoints: [],
    tags: [],
    active: true,
    verified: false,
    false_p: false,
    out_of_scope: false,
    risk_accepted: false,
    is_mitigated: false,
    planned_remediation_date: null,
    sla_expiration_date: null,
    accepted_risks: [],
    ...overrides,
  };
}

const PRODUCT = {
  id: 7,
  name: "Test network 10.0.5.0/24",
  tags: ["subsurf", "dmz"],
  product_manager: 2,
  technical_contact: 3,
};

const USERS = [
  { id: 2, username: "anna.nowak" },
  { id: 3, username: "piotr.kowalski" },
];

const FINDINGS: RawFinding[] = [
  finding({
    id: 1,
    unique_id_from_tool: "subsurf:10.0.5.7:443:nginx-cve",
    tags: ["subsurf", "kev", "web"],
    verified: true,
    planned_remediation_date: "2026-11-28",
    sla_expiration_date: "2026-11-23",
  }),
  finding({
    id: 2,
    description: "10.0.5.7:22/tcp. SSH banner.",
    tags: ["ssh"],
    active: false,
    false_p: true,
    is_mitigated: true,
  }),
  // A host SubSurf has never seen up, and a finding without any address.
  finding({ id: 3, endpoints: [30] }),
  finding({ id: 4, description: "Somewhere" }),
];

const LOCATIONS: Record<string, { location_value: string }> = {
  "30": { location_value: "https://10.0.5.99" },
};

const page = (results: unknown[], extra: Record<string, unknown> = {}) =>
  Response.json({ count: results.length, next: null, previous: null, results, ...extra });

/** Answers requests to the test DefectDojo; everything else goes to the real fetch. */
function stubDefectDojo(findings: RawFinding[] = FINDINGS, status = 200) {
  const realFetch = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== "defectdojo.test") return realFetch(input, init);
    const authorized =
      new Headers(init?.headers).get("authorization") === "Token test-only-defectdojo-token";
    if (status !== 200 || !authorized) return new Response("{}", { status: authorized ? status : 401 });
    if (url.pathname === "/api/v2/products/") return page([PRODUCT]);
    if (url.pathname === "/api/v2/users/") return page(USERS);
    if (
      url.pathname === "/api/v2/findings/" &&
      url.searchParams.get("test__engagement__product") === String(PRODUCT.id)
    ) {
      return page(findings, { prefetch: { endpoints: LOCATIONS } });
    }
    return new Response("{}", { status: 404 });
  });
}

describe("POST /defectdojo/sync", () => {
  it("imports tags, owners, triage and remediation dates onto matching assets", async () => {
    const scanId = await ingestScan();
    stubDefectDojo();
    const { client } = await signInAs(server, { role: "editor" });

    const res = await client.post("/v1/defectdojo/sync");

    expect(res.status).toBe(200);
    const sync = DefectDojoSyncSchema.parse(await res.json());
    expect(sync).toMatchObject({ status: "succeeded", error: null });
    expect(sync.stats).toMatchObject({
      products: 1,
      findings: 4,
      matchedFindings: 2,
      unmatchedFindings: 2,
      hostsUpdated: 1,
      servicesUpdated: 2,
      triageSet: 2,
      remediationUpdated: 1,
    });

    const host = await prisma.host.findUniqueOrThrow({ where: { id: await hostIdOf("10.0.5.7") } });
    expect(host.tags).toEqual(["dmz", "owner:anna.nowak", "contact:piotr.kowalski"]);
    const https = await prisma.service.findUniqueOrThrow({ where: { id: await serviceIdOf("10.0.5.7", 443) } });
    expect(https).toMatchObject({ tags: ["kev", "web"], triage: "important" });
    // A false positive's tags describe nothing real.
    const ssh = await prisma.service.findUniqueOrThrow({ where: { id: await serviceIdOf("10.0.5.7", 22) } });
    expect(ssh).toMatchObject({ tags: [], triage: "false_positive" });

    const list = ScanHostListResponseSchema.parse(
      await (await client.get(`/v1/scans/${scanId}/hosts`)).json(),
    );
    const services = list.items.find((item) => item.ip === "10.0.5.7")?.services ?? [];
    expect(services.find((service) => service.port === 443)?.remediation).toEqual({
      plannedOn: "2026-11-28",
      slaDueOn: "2026-11-23",
      riskAcceptedUntil: null,
    });
    expect(services.find((service) => service.port === 22)?.remediation).toBeNull();
  });

  it("keeps what users set, merges tags once and clears dates of findings that are gone", async () => {
    await ingestScan();
    const serviceId = await serviceIdOf("10.0.5.7", 443);
    await prisma.service.update({ where: { id: serviceId }, data: { tags: ["Web"], triage: "reviewed" } });
    stubDefectDojo();
    const { client } = await signInAs(server, { role: "admin" });

    await client.post("/v1/defectdojo/sync");
    const again = DefectDojoSyncSchema.parse(await (await client.post("/v1/defectdojo/sync")).json());

    expect(await prisma.service.findUniqueOrThrow({ where: { id: serviceId } })).toMatchObject({
      tags: ["Web", "kev"],
      triage: "reviewed",
    });
    expect(again.stats).toMatchObject({ tagsAdded: 0, servicesUpdated: 0, triageSet: 0 });

    vi.restoreAllMocks();
    stubDefectDojo([]);
    const empty = DefectDojoSyncSchema.parse(await (await client.post("/v1/defectdojo/sync")).json());
    expect(empty.stats?.remediationUpdated).toBe(1);
    expect(await prisma.service.findUniqueOrThrow({ where: { id: serviceId } })).toMatchObject({
      remediationPlannedOn: null,
      slaDueOn: null,
      tags: ["Web", "kev"],
    });
  });

  it("records a failed sync when DefectDojo refuses the token", async () => {
    stubDefectDojo(FINDINGS, 401);
    const { client } = await signInAs(server, { role: "admin" });

    const res = await client.post("/v1/defectdojo/sync");

    expect(res.status).toBe(502);
    expect(ErrorResponseSchema.parse(await res.json()).error.code).toBe("DEFECTDOJO_UNAVAILABLE");
    const status = DefectDojoStatusSchema.parse(await (await client.get("/v1/defectdojo/sync")).json());
    expect(status).toMatchObject({ configured: true, lastSync: { status: "failed", stats: null } });
    expect(status.lastSync?.error).toContain("refused the API token");
  });

  it("is limited to roles with defectdojo:import; every role reads the status", async () => {
    stubDefectDojo();
    const analyst = await signInAs(server, { role: "analyst" });
    const viewer = await signInAs(server, { role: "viewer" });

    expect((await analyst.client.post("/v1/defectdojo/sync")).status).toBe(403);
    const status = await viewer.client.get("/v1/defectdojo/sync");
    expect(status.status).toBe(200);
    expect(DefectDojoStatusSchema.parse(await status.json())).toEqual({
      configured: true,
      url: "http://defectdojo.test",
      lastSync: null,
      lastPush: null,
    });
  });
});

const locate = (overrides: Partial<DojoFinding>): DojoFinding => ({
  ...finding({ id: 1 }),
  locations: [],
  ...overrides,
});

describe("DefectDojo import rules", () => {
  it("finds the host:port in our id, the description prefix or the locations", () => {
    expect(findingAddresses(locate({ unique_id_from_tool: "subsurf:10.0.0.1:8443:x" }))).toEqual([
      { ip: "10.0.0.1", port: 8443 },
    ]);
    expect(findingAddresses(locate({ description: "10.0.0.2:21/tcp. FTP" }))).toEqual([
      { ip: "10.0.0.2", port: 21 },
    ]);
    expect(
      findingAddresses(
        locate({ locations: ["https://10.0.0.3", "ssh://10.0.0.3:22", "https://www.example.org", "ftp://10.0.0.3"] }),
      ),
    ).toEqual([
      { ip: "10.0.0.3", port: 443 },
      { ip: "10.0.0.3", port: 22 },
    ]);
    expect(findingAddresses(locate({ unique_id_from_tool: "subsurf:999.0.0.1:1:x" }))).toEqual([]);
  });

  it("derives triage only from a settled set of findings", () => {
    const open = locate({});
    const confirmed = locate({ verified: true });
    const falsePositive = locate({ active: false, false_p: true, is_mitigated: true });
    const fixed = locate({ active: false, is_mitigated: true });

    expect(triageFromFindings([open, confirmed])).toBe("important");
    expect(triageFromFindings([open, falsePositive])).toBeNull();
    expect(triageFromFindings([falsePositive])).toBe("false_positive");
    expect(triageFromFindings([falsePositive, fixed])).toBe("reviewed");
    // A reimport closes findings the same way a person marks them fixed: no verdict.
    expect(triageFromFindings([fixed])).toBeNull();
    // Our own pushed observation only counts once someone decided something on it.
    const ownOpen = locate({ unique_id_from_tool: "subsurf:10.0.0.1:443:service" });
    const accepted = locate({ active: false, risk_accepted: true });
    expect(triageFromFindings([ownOpen, accepted])).toBe("reviewed");
    expect(triageFromFindings([{ ...ownOpen, active: false, false_p: true }])).toBe("false_positive");
  });

  it("takes the earliest date, and SLA and plans of open findings only", () => {
    expect(
      remediationFromFindings([
        locate({ sla_expiration_date: "2026-12-10", planned_remediation_date: "2026-12-01" }),
        locate({ sla_expiration_date: "2026-11-30" }),
        locate({ active: false, sla_expiration_date: "2026-11-01" }),
        locate({
          active: false,
          risk_accepted: true,
          accepted_risks: [{ expiration_date: "2026-12-31T00:00:00Z" }],
        }),
      ]),
    ).toEqual({ plannedOn: "2026-12-01", slaDueOn: "2026-11-30", riskAcceptedUntil: "2026-12-31" });
  });

  it("merges tags case-insensitively up to the limit of a user edit", () => {
    const full = Array.from({ length: 19 }, (_, i) => `t${i}`);
    expect(mergeTags(["DMZ", ...full], ["dmz", "new", "more"])).toEqual({
      tags: ["DMZ", ...full],
      added: 0,
      skipped: 2,
    });
    expect(mergeTags(["a"], ["b", "A", "b"])).toEqual({ tags: ["a", "b"], added: 1, skipped: 0 });
  });
});

const UploadedReportSchema = z.object({ findings: z.array(z.record(z.string(), z.unknown())) });

interface Upload {
  kind: string;
  fields: Record<string, string>;
  report: z.infer<typeof UploadedReportSchema>;
}

/** A DefectDojo that records every import/reimport; `/tests/{id}/` exists unless deleted. */
function stubDefectDojoImports(options: { importStatus?: number; deletedTests?: number[] } = {}) {
  const realFetch = globalThis.fetch;
  const uploads: Upload[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.host !== "defectdojo.test") return realFetch(input, init);
    const test = /^\/api\/v2\/tests\/(\d+)\/$/.exec(url.pathname);
    if (test) {
      return options.deletedTests?.includes(Number(test[1]))
        ? new Response("{}", { status: 404 })
        : Response.json({ id: Number(test[1]) });
    }
    const upload = /^\/api\/v2\/(import|reimport)-scan\/$/.exec(url.pathname);
    if (!upload || !(init?.body instanceof FormData)) return new Response("{}", { status: 404 });
    if (options.importStatus) return new Response('{"message":"boom"}', { status: options.importStatus });
    const fields: Record<string, string> = {};
    for (const [key, value] of init.body.entries()) if (typeof value === "string") fields[key] = value;
    const file = init.body.get("file");
    const report = UploadedReportSchema.parse(JSON.parse(file instanceof Blob ? await file.text() : "{}"));
    uploads.push({ kind: upload[1], fields, report });
    const count = report.findings.length;
    return Response.json({
      test_id: Number(fields.test ?? 41),
      statistics: {
        after: { total: { total: count } },
        delta: {
          created: { total: { total: upload[1] === "import" ? count : 0 } },
          closed: { total: { total: 0 } },
          reactivated: { total: { total: 0 } },
          untouched: { total: { total: upload[1] === "import" ? 0 : count } },
        },
      },
    });
  });
  return uploads;
}

describe("POST /defectdojo/push", () => {
  it("imports the whole scan once, then reimports into the same test", async () => {
    const scanId = await ingestScan();
    const https = await serviceIdOf("10.0.5.7", 443);
    const ssh = await serviceIdOf("10.0.5.7", 22);
    await prisma.service.update({ where: { id: https }, data: { triage: "important", tags: ["wiki page"] } });
    await prisma.service.update({ where: { id: ssh }, data: { triage: "false_positive" } });
    const uploads = stubDefectDojoImports();
    const { client } = await signInAs(server, { role: "editor" });

    const first = DefectDojoPushSchema.parse(
      await (await client.post("/v1/defectdojo/push", { body: { scanId } })).json(),
    );
    const second = DefectDojoPushSchema.parse(
      await (await client.post("/v1/defectdojo/push", { body: { scanId } })).json(),
    );

    expect(first).toMatchObject({ status: "succeeded", scope: "scan", findings: 2, testId: 41 });
    expect(first.stats).toEqual({ created: 2, closed: 0, reactivated: 0, untouched: 0 });
    expect(second).toMatchObject({ testId: 41, stats: { created: 0, untouched: 2 } });
    expect(uploads.map((upload) => upload.kind)).toEqual(["import", "reimport"]);
    expect(uploads[0]?.fields).toMatchObject({
      scan_type: "Generic Findings Import",
      product_name: "SubSurf discovery",
      auto_create_context: "true",
      close_old_findings: "true",
    });
    expect(uploads[1]?.fields).toMatchObject({ test: "41", close_old_findings: "true" });
    expect(uploads[1]?.fields.product_name).toBeUndefined();

    const findings = uploads[0]?.report.findings ?? [];
    const byId = (id: string) => findings.find((item) => item.unique_id_from_tool === id);
    expect(byId("subsurf:10.0.5.7:443:service")).toMatchObject({
      severity: "Info",
      active: true,
      verified: true,
      false_p: false,
      tags: ["subsurf", "wiki-page"],
    });
    expect(String(byId("subsurf:10.0.5.7:443:service")?.description)).toMatch(/^10\.0\.5\.7:443\/tcp\. /);
    expect(byId("subsurf:10.0.5.7:22:service")).toMatchObject({ active: false, false_p: true });
  });

  it("pushes a selection without closing anything, and imports anew when the test is gone", async () => {
    const scanId = await ingestScan();
    const uploads = stubDefectDojoImports({ deletedTests: [41] });
    const { client } = await signInAs(server, { role: "admin" });
    await client.post("/v1/defectdojo/push", { body: { scanId } });

    const res = await client.post("/v1/defectdojo/push", {
      body: { scanId, serviceIds: [await serviceIdOf("10.0.5.7", 22)] },
    });

    expect(DefectDojoPushSchema.parse(await res.json())).toMatchObject({ scope: "selection", findings: 1 });
    expect(uploads.map((upload) => upload.kind)).toEqual(["import", "import"]);
    expect(uploads[1]?.fields.close_old_findings).toBe("false");
    expect(uploads[1]?.report.findings.map((item) => item.unique_id_from_tool)).toEqual([
      "subsurf:10.0.5.7:22:service",
    ]);
  });

  it("records a failed push and refuses what cannot be pushed", async () => {
    const scanId = await ingestScan();
    const empty = await ingestScan((hosts) => hosts.map((host) => ({ ...host, ports: [] })));
    stubDefectDojoImports({ importStatus: 500 });
    const { client } = await signInAs(server, { role: "admin" });
    const analyst = await signInAs(server, { role: "analyst" });

    const failed = await client.post("/v1/defectdojo/push", { body: { scanId } });
    expect(failed.status).toBe(502);
    const status = DefectDojoStatusSchema.parse(await (await client.get("/v1/defectdojo/sync")).json());
    expect(status.lastPush).toMatchObject({ status: "failed", scanId, testId: null });

    const nothing = await client.post("/v1/defectdojo/push", { body: { scanId: empty } });
    expect(nothing.status).toBe(400);
    expect(ErrorResponseSchema.parse(await nothing.json()).error.code).toBe("NOTHING_TO_PUSH");
    expect((await analyst.client.post("/v1/defectdojo/push", { body: { scanId } })).status).toBe(403);
  });
});
