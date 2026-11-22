import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ScanHostDetailSchema,
  ScanHostListResponseSchema,
} from "@subsurf/contracts/scans/scan-results.schema";

import { prisma } from "~backend/lib/prisma";
import { rematch } from "~backend/modules/vulnerabilities/matching/matching.service";
import { writeRecords } from "~backend/modules/vulnerabilities/sync/records";
import { vulnerabilityRecord } from "~backend/modules/vulnerabilities/test/fixtures";
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

const nginx = (id: string, severity: "critical" | "medium", kev = false) =>
  vulnerabilityRecord(id, {
    title: `${id} in nginx`,
    severity,
    cvssScore: severity === "critical" ? 9.8 : 5.3,
    kevAddedAt: kev ? new Date("2026-01-02T00:00:00Z") : null,
    references: ["https://nginx.org/en/security_advisories.html"],
    criteria: [
      {
        kind: "cpe",
        matchKey: "cpe:a:nginx:nginx",
        data: { conditions: [{ endExcluding: "1.27.1" }] },
      },
    ],
  });

let scanId: string;

beforeEach(async () => {
  await prisma.vulnerabilitySource.create({ data: { id: "nvd" } });
  await writeRecords(
    "nvd",
    [
      nginx("CVE-2026-0001", "critical", true),
      nginx("CVE-2026-0002", "medium"),
      // Matches SSH 9.6p1 on Ubuntu: potential, the distribution may have backported the fix.
      vulnerabilityRecord("CVE-2024-6387", { severity: "high" }),
    ],
    new Date(),
  );
  scanId = await ingestScan();
  await rematch("all", pino({ level: "silent" }));
});

describe("vulnerabilities in scan results", () => {
  it("summarizes hosts and services per CVE", async () => {
    const { client } = await signInAs(server, { role: "viewer" });
    const res = await client.get(`/v1/scans/${scanId}/hosts`);
    const { items } = ScanHostListResponseSchema.parse(await res.json());
    const host = items.find((item) => item.ip === "10.0.5.7");
    expect(host?.vulnerabilities).toEqual({
      confirmed: 2,
      potential: 1,
      kev: 1,
      maxSeverity: "critical",
    });
    const confirmed = host?.services.map((service) => [
      service.port,
      service.vulnerabilities.confirmed,
    ]);
    expect(confirmed).toEqual([
      [22, 0],
      [443, 2],
    ]);
  });

  it("lists a service's vulnerabilities in the host detail, most severe first", async () => {
    const { client } = await signInAs(server, { role: "viewer" });
    const hostId = await hostIdOf("10.0.5.7");
    const res = await client.get(`/v1/scans/${scanId}/hosts/${hostId}`);
    const detail = ScanHostDetailSchema.parse(await res.json());
    const https = detail.services.find((service) => service.port === 443);
    expect(https?.vulnerabilityMatches.map((match) => match.canonicalId)).toEqual([
      "CVE-2026-0001",
      "CVE-2026-0002",
    ]);
    expect(https?.vulnerabilityMatches[0]).toMatchObject({
      title: "CVE-2026-0001 in nginx",
      severity: "critical",
      kevAddedAt: "2026-01-02T00:00:00.000Z",
      confidence: "confirmed",
      basis: { scanId, cpe: "cpe:/a:nginx:nginx:1.24.0", version: "1.24.0" },
      evidence: [
        {
          sourceId: "nvd",
          externalId: "CVE-2026-0001",
          verdict: "affected",
          url: "https://nvd.nist.gov/vuln/detail/CVE-2026-0001",
        },
      ],
      triage: "unreviewed",
    });
    const ssh = detail.services.find((service) => service.port === 22);
    expect(ssh?.vulnerabilityMatches[0]).toMatchObject({
      confidence: "potential",
      reasons: ["distro_backport_possible"],
    });
  });

  it("filters hosts by confirmed vulnerabilities and leaves false positives out", async () => {
    const { client } = await signInAs(server, { role: "analyst" });
    const list = async (filter: string) =>
      ScanHostListResponseSchema.parse(
        await (await client.get(`/v1/scans/${scanId}/hosts?vulnerability=${filter}`)).json(),
      ).items.map((host) => host.ip);
    expect(await list("kev")).toEqual(["10.0.5.7"]);

    const serviceId = await serviceIdOf("10.0.5.7", 443);
    for (const id of ["CVE-2026-0001", "CVE-2026-0002"]) {
      await client.patch(`/v1/vulnerabilities/services/${serviceId}/${id}`, {
        body: { triage: "false_positive" },
      });
    }
    expect(await list("any")).toEqual([]);
    const res = await client.get(`/v1/scans/${scanId}/hosts`);
    const host = ScanHostListResponseSchema.parse(await res.json()).items[0];
    expect(host.vulnerabilities).toMatchObject({ confirmed: 0, potential: 1, kev: 0 });
  });
});
