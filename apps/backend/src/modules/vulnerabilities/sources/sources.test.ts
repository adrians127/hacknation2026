import { describe, expect, it } from "vitest";

import { canonicalIdOf } from "~backend/modules/vulnerabilities/sources/canonical";
import { createNvdSource } from "~backend/modules/vulnerabilities/sources/nvd/nvd.source";
import {
  normalizeNvdCve,
  NvdCveSchema,
} from "~backend/modules/vulnerabilities/sources/nvd/nvd.parser";
import { createOsvSource } from "~backend/modules/vulnerabilities/sources/osv/osv.source";
import {
  normalizeOsvRecord,
  OsvRecordSchema,
  splitEcosystem,
} from "~backend/modules/vulnerabilities/sources/osv/osv.parser";
import type { NormalizedVulnerability } from "~backend/modules/vulnerabilities/sources/source";
import {
  collect,
  FakeFetcher,
  JETTY_GHSA,
  MISFORTUNE_COOKIE,
  nvdFeed,
  osvZip,
  REGRESSHION,
  REJECTED,
  syncContext,
  TERRAPIN_DEBIAN,
} from "~backend/modules/vulnerabilities/test/fixtures";

const NVD_URL = "https://nvd.example/feeds";
const OSV_URL = "https://osv.example";

const nvd = (cve: object) => normalizeNvdCve(NvdCveSchema.parse(cve));
const osv = (record: object, scope: string) =>
  normalizeOsvRecord(OsvRecordSchema.parse(record), scope);

const upserts = (events: Awaited<ReturnType<typeof collect>>): NormalizedVulnerability[] =>
  events.flatMap((event) => (event.type === "upsert" ? [event.record] : []));

describe("canonicalIdOf", () => {
  it("finds the CVE in the id, else the single CVE alias", () => {
    expect(canonicalIdOf("CVE-2024-6387")).toBe("CVE-2024-6387");
    expect(canonicalIdOf("DEBIAN-CVE-2023-48795")).toBe("CVE-2023-48795");
    expect(canonicalIdOf("GHSA-1", ["CVE-2024-6763", "GO-2024-1"])).toBe("CVE-2024-6763");
    expect(canonicalIdOf("GHSA-2", ["CVE-2024-1", "CVE-2024-2"])).toBe("GHSA-2");
    expect(canonicalIdOf("GHSA-3")).toBe("GHSA-3");
  });
});

describe("NVD records", () => {
  it("turns configurations into one CPE criterion per product", () => {
    const record = nvd(REGRESSHION);
    expect(record).toMatchObject({
      externalId: "CVE-2024-6387",
      canonicalId: "CVE-2024-6387",
      status: "active",
      severity: "high",
      cvssScore: 8.1,
      kevAddedAt: null,
    });
    expect(record.publishedAt?.toISOString()).toBe("2024-07-01T13:15:01.633Z");
    expect(record.criteria.map((criterion) => criterion.matchKey)).toEqual([
      "cpe:a:openbsd:openssh",
      "cpe:o:netapp:ontap",
    ]);
    expect(record.criteria[0].data).toEqual({
      conditions: [
        { endExcluding: "4.4" },
        { startIncluding: "8.5", endExcluding: "9.8" },
        { versions: ["4.4", "4.4p1"] },
      ],
    });
    expect(record.criteria[1].data).toEqual({
      conditions: [
        {
          any: true,
          platforms: [{ part: "h", vendor: "netapp", product: "a250", version: null }],
        },
      ],
    });
  });

  it("keeps CISA KEV dates and rejected records without criteria", () => {
    expect(nvd(MISFORTUNE_COOKIE)).toMatchObject({
      severity: "critical",
      title: "AllegroSoft RomPager Authentication Bypass Vulnerability",
    });
    expect(nvd(MISFORTUNE_COOKIE).kevAddedAt?.toISOString()).toBe("2022-03-28T00:00:00.000Z");
    expect(nvd(REJECTED)).toMatchObject({ status: "rejected", criteria: [], severity: "unknown" });
  });
});

describe("NVD source", () => {
  const year = nvdFeed([REGRESSHION, MISFORTUNE_COOKIE]);
  const modified = nvdFeed([REJECTED]);
  const fetcher = () =>
    new FakeFetcher()
      .set(`${NVD_URL}/nvdcve-2.0-2026.json.gz`, year.gz)
      .set(`${NVD_URL}/nvdcve-2.0-2026.meta`, year.meta)
      .set(`${NVD_URL}/nvdcve-2.0-modified.json.gz`, modified.gz)
      .set(`${NVD_URL}/nvdcve-2.0-modified.meta`, modified.meta);
  const source = createNvdSource({ feedUrl: NVD_URL, firstYear: 2026 });

  it("reads every year, completes the scope, then applies the modified feed", async () => {
    const events = await collect(source, syncContext(fetcher()));
    expect(events.map((event) => event.type)).toEqual([
      "upsert",
      "upsert",
      "scopeCompleted",
      "upsert",
      "checkpoint",
    ]);
    expect(upserts(events).map((record) => record.externalId)).toEqual([
      "CVE-2024-6387",
      "CVE-2014-9222",
      "CVE-2024-99999",
    ]);
  });

  it("skips an unchanged modified feed and asks for a full sync after a long gap", async () => {
    const [, , , , checkpoint] = await collect(source, syncContext(fetcher()));
    if (checkpoint.type !== "checkpoint") throw new Error("Expected a checkpoint");

    const next = await collect(
      source,
      syncContext(fetcher(), { mode: "incremental", cursor: checkpoint.cursor }),
    );
    expect(next.map((event) => event.type)).toEqual(["checkpoint"]);

    const stale = await collect(
      source,
      syncContext(fetcher(), {
        mode: "incremental",
        cursor: checkpoint.cursor,
        now: new Date("2026-12-21T12:00:00Z"),
      }),
    );
    expect(stale.map((event) => event.type)).toEqual(["needsFull"]);
  });

  it("refuses a feed whose checksum does not match its .meta", async () => {
    const broken = fetcher().set(`${NVD_URL}/nvdcve-2.0-2026.meta`, modified.meta);
    await expect(collect(source, syncContext(broken))).rejects.toThrow(/checksum/);
  });
});

describe("OSV records", () => {
  it("splits ecosystems and keeps one package criterion per key", () => {
    expect(splitEcosystem("Debian:12")).toEqual({ ecosystem: "Debian", release: "12" });
    expect(splitEcosystem("Ubuntu:Pro:22.04:LTS")).toEqual({
      ecosystem: "Ubuntu",
      release: "22.04",
    });
    expect(splitEcosystem("Maven")).toEqual({ ecosystem: "Maven", release: null });

    const record = osv(TERRAPIN_DEBIAN, "Debian");
    expect(record).toMatchObject({
      canonicalId: "CVE-2023-48795",
      aliases: ["CVE-2023-48795"],
      scopes: ["Debian"],
      severity: "medium",
      cvssScore: 5.9,
    });
    expect(record.criteria).toHaveLength(1);
    expect(record.criteria[0].matchKey).toBe("pkg:Debian:openssh");
  });

  it("scores CVSS 4.0 vectors and marks withdrawn records", () => {
    expect(osv(JETTY_GHSA, "Maven")).toMatchObject({
      canonicalId: "CVE-2024-6763",
      cvssVersion: "4.0",
      severity: "medium",
    });
    const withdrawn = osv({ ...JETTY_GHSA, withdrawn: "2026-10-02T00:00:00Z" }, "Maven");
    expect(withdrawn).toMatchObject({ status: "withdrawn", criteria: [] });
  });
});

describe("OSV source", () => {
  const config = {
    baseUrl: OSV_URL,
    ecosystems: ["Maven", "Debian"],
    skipPrefixes: ["MAL-"],
    incrementalMaxRecords: 2,
  };
  const source = createOsvSource(config);

  async function fetcher() {
    return new FakeFetcher()
      .set(`${OSV_URL}/Maven/all.zip`, await osvZip([JETTY_GHSA, { id: "MAL-2026-1" }]))
      .set(`${OSV_URL}/Debian/all.zip`, await osvZip([TERRAPIN_DEBIAN]));
  }

  it("reads each ecosystem's zip, skips malicious-package reports, completes scopes", async () => {
    const events = await collect(source, syncContext(await fetcher()));
    expect(events.map((event) => event.type)).toEqual([
      "upsert",
      "scopeCompleted",
      "checkpoint",
      "upsert",
      "scopeCompleted",
      "checkpoint",
    ]);
    expect(events.at(-1)).toEqual({
      type: "checkpoint",
      cursor: {
        ecosystems: { Maven: "2026-09-01T00:00:00Z", Debian: "2026-10-01T00:00:00Z" },
        at: "2026-11-21T12:00:00.000Z",
      },
    });
  });

  it("fetches only the records changed since the cursor", async () => {
    const updated = { ...JETTY_GHSA, modified: "2026-11-20T00:00:00Z", summary: "Updated" };
    const csv = [
      `2026-11-20T00:00:00Z,${JETTY_GHSA.id}`,
      "2026-11-19T00:00:00Z,MAL-2026-2",
      "2026-09-01T00:00:00Z,GHSA-older",
    ].join("\n");
    const fake = (await fetcher())
      .set(`${OSV_URL}/Maven/modified_id.csv`, csv)
      .set(`${OSV_URL}/Maven/${JETTY_GHSA.id}.json`, JSON.stringify(updated))
      .set(`${OSV_URL}/Debian/modified_id.csv`, "2026-10-01T00:00:00Z,DEBIAN-CVE-2023-48795");
    const cursor = {
      ecosystems: { Maven: "2026-09-01T00:00:00Z", Debian: "2026-10-01T00:00:00Z" },
      at: "2026-11-20T12:00:00.000Z",
    };
    const events = await collect(source, syncContext(fake, { mode: "incremental", cursor }));
    expect(upserts(events).map((record) => record.title)).toEqual(["Updated"]);
    expect(fake.requests.some((url) => url.endsWith("all.zip"))).toBe(false);
    expect(events.at(-1)).toMatchObject({
      cursor: { ecosystems: { Maven: "2026-11-20T00:00:00Z", Debian: "2026-10-01T00:00:00Z" } },
    });
  });
});
