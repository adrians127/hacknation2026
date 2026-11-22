import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";

import type { ObservedHost } from "@subsurf/contracts/workers/worker-result.schema";

import { prisma } from "~backend/lib/prisma";
import { rematch } from "~backend/modules/vulnerabilities/matching/matching.service";
import { NewResultsWatcher } from "~backend/modules/vulnerabilities/matching/new-results";
import { acquireLease } from "~backend/modules/vulnerabilities/sync/lease";
import { writeRecords } from "~backend/modules/vulnerabilities/sync/records";
import { vulnerabilityRecord } from "~backend/modules/vulnerabilities/test/fixtures";
import { ingestScan, serviceIdOf } from "~backend/test/scans";

const log = pino({ level: "silent" });
const SEEN = new Date("2026-11-21T00:00:00Z");

/** The example host with SSH from Debian 12 (package revision 2+deb12u3) and nginx 1.24.0. */
function onDebian(hosts: ObservedHost[]): ObservedHost[] {
  return hosts.map((host) => ({
    ...host,
    ports: host.ports.map((port) =>
      port.port === 22 && port.service
        ? {
            ...port,
            service: {
              ...port.service,
              version: "9.2p1 Debian 2+deb12u3",
              extraInfo: "protocol 2.0",
              cpe: ["cpe:/a:openbsd:openssh:9.2p1"],
            },
          }
        : port,
    ),
  }));
}

function withNginx(version: string) {
  return (hosts: ObservedHost[]): ObservedHost[] =>
    onDebian(hosts).map((host) => ({
      ...host,
      ports: host.ports.map((port) =>
        port.port === 443 && port.service
          ? {
              ...port,
              service: { ...port.service, version, cpe: [`cpe:/a:nginx:nginx:${version}`] },
            }
          : port,
      ),
    }));
}

const nginxBefore = (end: string, modified = "2026-01-01T00:00:00Z") =>
  vulnerabilityRecord("CVE-2024-7347", {
    sourceModifiedAt: new Date(modified),
    criteria: [
      {
        kind: "cpe",
        matchKey: "cpe:a:nginx:nginx",
        data: { conditions: [{ startIncluding: "1.5.13", endExcluding: end }] },
      },
    ],
  });

const TERRAPIN_NVD = vulnerabilityRecord("CVE-2023-48795", {
  severity: "medium",
  cvssScore: 5.9,
  criteria: [
    {
      kind: "cpe",
      matchKey: "cpe:a:openbsd:openssh",
      data: { conditions: [{ endExcluding: "9.6" }] },
    },
  ],
});

const TERRAPIN_DEBIAN = vulnerabilityRecord("DEBIAN-CVE-2023-48795", {
  canonicalId: "CVE-2023-48795",
  severity: "unknown",
  cvssScore: null,
  scopes: ["Debian"],
  criteria: [
    {
      kind: "package",
      matchKey: "pkg:Debian:openssh",
      data: {
        entries: [
          {
            ecosystem: "Debian",
            release: "12",
            versions: [],
            ranges: [
              {
                type: "ECOSYSTEM",
                events: [{ introduced: "0" }, { fixed: "1:9.2p1-2+deb12u2" }],
              },
            ],
          },
        ],
      },
    },
  ],
});

async function matchesOf(ip: string, port: number) {
  return prisma.vulnerabilityMatch.findMany({
    where: { serviceId: await serviceIdOf(ip, port) },
    orderBy: { canonicalId: "asc" },
  });
}

beforeEach(async () => {
  await prisma.vulnerabilitySource.createMany({ data: [{ id: "nvd" }, { id: "osv" }] });
  await prisma.packageMapping.create({
    data: {
      cpeVendor: "openbsd",
      cpeProduct: "openssh",
      ecosystem: "Debian",
      packageName: "openssh",
    },
  });
  await writeRecords("nvd", [TERRAPIN_NVD, nginxBefore("1.27.1")], SEEN);
  await writeRecords("osv", [TERRAPIN_DEBIAN], SEEN);
});

describe("rematch", () => {
  it("matches services and lets the distribution's data overrule an upstream hit", async () => {
    await ingestScan(onDebian);
    expect(await rematch("all", log)).toMatchObject({ services: 2, added: 2, retracted: 0 });

    const [terrapin] = await matchesOf("10.0.5.7", 22);
    expect(terrapin).toMatchObject({
      canonicalId: "CVE-2023-48795",
      confidence: "potential",
      reasons: ["fixed_by_backport"],
      severity: "medium",
      status: "active",
      basis: { cpe: "cpe:/a:openbsd:openssh:9.2p1", version: "9.2p1" },
    });
    expect(terrapin.evidence).toMatchObject([
      { sourceId: "nvd", externalId: "CVE-2023-48795", verdict: "affected" },
      { sourceId: "osv", externalId: "DEBIAN-CVE-2023-48795", verdict: "not_affected" },
    ]);
    const [nginx] = await matchesOf("10.0.5.7", 443);
    expect(nginx).toMatchObject({ canonicalId: "CVE-2024-7347", confidence: "confirmed" });
  });

  it("retracts matches with the reason and brings them back with their history", async () => {
    await ingestScan(onDebian);
    await rematch("all", log);
    const [first] = await matchesOf("10.0.5.7", 443);

    await writeRecords("nvd", [nginxBefore("1.20.0", "2026-02-01T00:00:00Z")], SEEN);
    expect(await rematch("all", log)).toMatchObject({ retracted: 1 });
    expect((await matchesOf("10.0.5.7", 443))[0]).toMatchObject({
      status: "retracted",
      retractReason: "criteria_changed",
    });

    await writeRecords("nvd", [nginxBefore("1.27.1", "2026-03-01T00:00:00Z")], SEEN);
    expect(await rematch("all", log)).toMatchObject({ reactivated: 1 });
    const [back] = await matchesOf("10.0.5.7", 443);
    expect(back).toMatchObject({ status: "active", retractReason: null });
    expect(back.firstMatchedAt).toEqual(first.firstMatchedAt);

    const rejected = nginxBefore("1.27.1", "2026-04-01T00:00:00Z");
    await writeRecords("nvd", [{ ...rejected, status: "rejected", criteria: [] }], SEEN);
    await rematch("all", log);
    expect((await matchesOf("10.0.5.7", 443))[0].retractReason).toBe("source_withdrawn");
  });

  it("retracts a disabled source's matches and a changed service's", async () => {
    await ingestScan(onDebian);
    await rematch("all", log);

    await prisma.vulnerabilitySource.update({ where: { id: "nvd" }, data: { enabled: false } });
    await rematch("all", log);
    expect((await matchesOf("10.0.5.7", 443))[0].retractReason).toBe("source_disabled");

    await prisma.vulnerabilitySource.update({ where: { id: "nvd" }, data: { enabled: true } });
    await rematch("all", log);
    await ingestScan(withNginx("1.27.2"));
    await rematch([await serviceIdOf("10.0.5.7", 443)], log);
    expect((await matchesOf("10.0.5.7", 443))[0]).toMatchObject({
      status: "retracted",
      retractReason: "service_changed",
    });
  });
});

describe("NewResultsWatcher", () => {
  it("matches the services of each new scan result once", async () => {
    if (!(await acquireLease("watcher"))) throw new Error("Lease taken");
    const watcher = new NewResultsWatcher("watcher", log);
    expect(await watcher.poll()).toBeNull();

    await ingestScan(onDebian);
    expect(await watcher.poll()).toMatchObject({ services: 2, added: 2 });
    expect(await watcher.poll()).toBeNull();

    await ingestScan(withNginx("1.27.2"));
    expect(await watcher.poll()).toMatchObject({ services: 2, retracted: 1 });
  });
});
