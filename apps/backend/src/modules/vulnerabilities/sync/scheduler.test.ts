import { pino } from "pino";
import { describe, expect, it } from "vitest";

import { prisma } from "~backend/lib/prisma";
import { acquireLease } from "~backend/modules/vulnerabilities/sync/lease";
import {
  dueMode,
  VulnerabilityScheduler,
} from "~backend/modules/vulnerabilities/sync/scheduler";
import { FakeFetcher } from "~backend/modules/vulnerabilities/test/fixtures";

const HOUR = 60 * 60 * 1000;
const schedule = { incrementalEveryMs: 8 * HOUR, fullEveryMs: 7 * 24 * HOUR };
const now = new Date("2026-11-21T12:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);

describe("dueMode", () => {
  it.each([
    ["never synced", null, null, "full"],
    ["full a week ago", ago(24 * 7 + 1), ago(1), "full"],
    ["incremental 9 hours ago", ago(48), ago(9), "incremental"],
    ["incremental 7 hours ago", ago(48), ago(7), null],
  ] as const)("%s", (_name, lastFullAt, lastIncrementalAt, mode) => {
    expect(dueMode({ lastFullAt, lastIncrementalAt }, now, schedule)).toBe(mode);
  });
});

const scheduler = (holder: string) =>
  new VulnerabilityScheduler({
    holder,
    fetcher: new FakeFetcher(),
    log: pino({ level: "silent" }),
    schedule,
  });

describe("VulnerabilityScheduler.tick", () => {
  it("handles requests from the API, and leaves the work to the lease holder", async () => {
    await prisma.vulnerabilityJobRequest.createMany({
      data: [{ kind: "rematch" }, { kind: "rematch" }],
    });
    const signal = new AbortController().signal;
    // Disabled sources are not synced, so the pass only handles the requests.
    await prisma.vulnerabilitySource.createMany({
      data: [
        { id: "nvd", enabled: false },
        { id: "osv", enabled: false },
      ],
    });
    expect(await scheduler("first").tick(signal)).toBe(true);
    expect(await prisma.vulnerabilityJobRequest.count({ where: { takenAt: null } })).toBe(0);

    expect(await acquireLease("first")).toBe(true);
    expect(await scheduler("second").tick(signal)).toBe(false);
  });
});
