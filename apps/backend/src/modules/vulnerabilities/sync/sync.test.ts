import { pino } from "pino";
import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "~backend/lib/prisma";
import type {
  NormalizedVulnerability,
  SourceEvent,
  VulnerabilitySource,
} from "~backend/modules/vulnerabilities/sources/source";
import {
  acquireLease,
  assertLease,
  releaseLease,
} from "~backend/modules/vulnerabilities/sync/lease";
import { runSync, type SyncOptions } from "~backend/modules/vulnerabilities/sync/sync.service";
import {
  FakeFetcher,
  vulnerabilityRecord as record,
} from "~backend/modules/vulnerabilities/test/fixtures";

const HOLDER = "test-holder";

/** Emits whatever the test scripts, the way a real source would. */
function scriptedSource(script: () => SourceEvent[] | Error): VulnerabilitySource {
  return {
    id: "fake",
    displayName: "Fake",
    baseUrl: "file:///fake",
    scopes: [],
    detailUrl: (id) => `https://fake.example/${id}`,
    async *sync() {
      const events = script();
      if (events instanceof Error) throw events;
      for (const event of events) {
        if (event.type === "upsert" && event.record.externalId === "BOOM") {
          throw new Error("Download broke halfway");
        }
        yield event;
      }
    },
    async *importFile() {},
  };
}

const upsert = (item: NormalizedVulnerability): SourceEvent => ({ type: "upsert", record: item });
const completed: SourceEvent = { type: "scopeCompleted", scope: null };

function options(source: VulnerabilitySource, overrides: Partial<SyncOptions> = {}): SyncOptions {
  return {
    source,
    mode: "full",
    trigger: "cli",
    holder: HOLDER,
    fetcher: new FakeFetcher(),
    signal: new AbortController().signal,
    log: pino({ level: "silent" }),
    ...overrides,
  };
}

const statusOf = async (externalId: string) =>
  (await prisma.vulnerability.findFirstOrThrow({ where: { externalId } })).status;

beforeEach(async () => {
  await prisma.vulnerabilitySource.create({ data: { id: "fake" } });
  if (!(await acquireLease(HOLDER))) throw new Error("The test lease is taken");
});

const sync = (events: SourceEvent[], overrides: Partial<SyncOptions> = {}) =>
  runSync(options(scriptedSource(() => events), overrides));

describe("runSync", () => {
  it("stores records with their criteria and the source's state", async () => {
    const source = scriptedSource(() => [
      upsert(record("CVE-1")),
      upsert(record("CVE-2", { criteria: [] })),
      completed,
      { type: "checkpoint", cursor: { at: "x" } },
    ]);
    const outcome = await runSync(options(source));
    expect(outcome).toMatchObject({ status: "succeeded", stats: { upserted: 2, unchanged: 0 } });

    expect(await prisma.vulnerabilityCriterion.count()).toBe(1);
    const state = await prisma.vulnerabilitySource.findUniqueOrThrow({ where: { id: "fake" } });
    expect(state).toMatchObject({ cursor: { at: "x" }, recordCount: 2, lastError: null });
    expect(state.lastFullAt).not.toBeNull();
    const run = await prisma.vulnerabilitySyncRun.findUniqueOrThrow({
      where: { id: outcome.runId },
    });
    expect(run).toMatchObject({ status: "succeeded", mode: "full" });
  });

  it("rewrites only changed records and replaces their criteria", async () => {
    await sync([upsert(record("CVE-1")), upsert(record("CVE-2"))]);
    const corrected = record("CVE-1", {
      sourceModifiedAt: new Date("2026-02-01T00:00:00Z"),
      criteria: [
        {
          kind: "cpe",
          matchKey: "cpe:a:nginx:nginx",
          data: { conditions: [{ endExcluding: "1.25" }] },
        },
      ],
    });
    const outcome = await runSync(
      options(scriptedSource(() => [upsert(corrected), upsert(record("CVE-2"))]), {
        mode: "incremental",
      }),
    );
    expect(outcome.stats).toMatchObject({ upserted: 1, unchanged: 1 });
    const keys = await prisma.vulnerabilityCriterion.findMany({
      where: { vulnerability: { externalId: "CVE-1" } },
      select: { matchKey: true },
    });
    expect(keys).toEqual([{ matchKey: "cpe:a:nginx:nginx" }]);
  });

  it("withdraws records a complete full sync no longer saw, and records rejections", async () => {
    await sync([upsert(record("CVE-1")), upsert(record("CVE-2"))]);
    const rejected = record("CVE-2", {
      status: "rejected",
      sourceModifiedAt: new Date("2026-03-01T00:00:00Z"),
      criteria: [],
    });
    await runSync(options(scriptedSource(() => [upsert(rejected)]), { mode: "incremental" }));
    expect(await statusOf("CVE-2")).toBe("rejected");

    const outcome = await sync([upsert(record("CVE-3")), completed]);
    expect(outcome.stats.swept).toBe(1);
    expect(await statusOf("CVE-1")).toBe("withdrawn");
    expect(await statusOf("CVE-3")).toBe("active");
  });

  it("never sweeps after a failure or an incomplete scope", async () => {
    await runSync(options(scriptedSource(() => [upsert(record("CVE-1")), completed])));
    const failed = await runSync(
      options(scriptedSource(() => [upsert(record("CVE-2")), upsert(record("BOOM")), completed])),
    );
    expect(failed).toMatchObject({ status: "failed", error: "Download broke halfway" });
    expect(await statusOf("CVE-1")).toBe("active");

    await runSync(options(scriptedSource(() => [upsert(record("CVE-2"))])));
    expect(await statusOf("CVE-1")).toBe("active");
    const state = await prisma.vulnerabilitySource.findUniqueOrThrow({ where: { id: "fake" } });
    expect(state.lastError).toBeNull();
  });

  it("refuses to sweep most of a source", async () => {
    const many = Array.from({ length: 40 }, (_, index) => upsert(record(`CVE-${index}`)));
    await runSync(options(scriptedSource(() => [...many, completed])));
    const outcome = await sync([upsert(record("CVE-0")), completed]);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toMatch(/Refusing to withdraw 39 of 40/);
    expect(await prisma.vulnerability.count({ where: { status: "active" } })).toBe(40);
  });

  it("reports when an incremental sync cannot catch up", async () => {
    const source = scriptedSource(() => [{ type: "needsFull", reason: "No full sync yet" }]);
    const outcome = await runSync(options(source, { mode: "incremental" }));
    expect(outcome).toMatchObject({ status: "cancelled", needsFull: true });
  });

  it("stops writing cursors once the lease is lost", async () => {
    const source = scriptedSource(() => [
      upsert(record("CVE-1")),
      { type: "checkpoint", cursor: { at: "x" } },
    ]);
    await releaseLease(HOLDER);
    const outcome = await runSync(options(source));
    expect(outcome.status).toBe("failed");
    const state = await prisma.vulnerabilitySource.findUniqueOrThrow({ where: { id: "fake" } });
    expect(state.cursor).toBeNull();
  });
});

describe("lease", () => {
  it("lets one holder work at a time and frees an expired lease", async () => {
    expect(await acquireLease("other")).toBe(false);
    await expect(assertLease("other")).rejects.toThrow(/no longer held/);

    await prisma.$executeRaw`
      UPDATE "VulnerabilitySyncState" SET "lockExpiresAt" = now() - interval '1 minute'`;
    expect(await acquireLease("other")).toBe(true);
    await expect(assertLease(HOLDER)).rejects.toThrow(/no longer held/);
  });
});
