import { describe, expect, it } from "vitest";

import type { Schedule } from "@subsurf/contracts/pipelines/pipelines.schema";

import { lastFireAtOrBefore, nextFireAfter, nextFireTimes } from "~backend/modules/pipelines/schedule";

const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

const daily: Schedule = {
  every: 1,
  unit: "day",
  startsAt: "2026-10-22T01:00",
  daysOfWeek: [],
  windowMinutes: 240,
  timezone: "Europe/Warsaw",
};

describe("nextFireTimes", () => {
  it("keeps the wall-clock time across the end of summer time", () => {
    // 2026-10-25 03:00 CEST becomes 02:00 CET: 01:00 local moves from 23:00 to 00:00 UTC.
    expect(iso(nextFireTimes(daily, new Date("2026-10-23T12:00:00Z"), 3))).toEqual([
      "2026-10-23T23:00:00.000Z",
      "2026-10-24T23:00:00.000Z",
      "2026-10-26T00:00:00.000Z",
    ]);
  });

  it("starts at startsAt when it is still ahead", () => {
    expect(iso(nextFireTimes(daily, new Date("2026-01-01T00:00:00Z"), 1))).toEqual([
      "2026-10-21T23:00:00.000Z",
    ]);
  });

  it("runs hourly only on the allowed days", () => {
    const hourly: Schedule = {
      ...daily,
      unit: "hour",
      every: 6,
      startsAt: "2026-11-20T00:00",
      daysOfWeek: [1], // Monday
      windowMinutes: 30,
      timezone: "UTC",
    };
    // 2026-11-21 is a Saturday; the next Monday is 2026-11-23.
    expect(iso(nextFireTimes(hourly, new Date("2026-11-21T10:00:00Z"), 5))).toEqual([
      "2026-11-23T00:00:00.000Z",
      "2026-11-23T06:00:00.000Z",
      "2026-11-23T12:00:00.000Z",
      "2026-11-23T18:00:00.000Z",
      "2026-11-30T00:00:00.000Z",
    ]);
  });

  it("is strictly after the given time", () => {
    const at = new Date("2026-10-23T23:00:00Z");
    expect(nextFireAfter(daily, at)?.toISOString()).toBe("2026-10-24T23:00:00.000Z");
  });

  it("returns nothing for a schedule that never lands on its days", () => {
    // Every 7 days from a Thursday never reaches a Monday.
    expect(nextFireAfter({ ...daily, every: 7, daysOfWeek: [1] }, new Date("2026-10-23T00:00:00Z"))).toBeNull();
  });
});

describe("lastFireAtOrBefore", () => {
  it("collapses missed fires into the latest one", () => {
    const at = new Date("2026-11-05T12:00:00Z");
    expect(lastFireAtOrBefore(daily, at)?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });

  it("includes a fire exactly at the given time, and nothing before startsAt", () => {
    const fire = new Date("2026-10-23T23:00:00Z");
    expect(lastFireAtOrBefore(daily, fire)?.toISOString()).toBe(fire.toISOString());
    expect(lastFireAtOrBefore(daily, new Date("2026-10-01T00:00:00Z"))).toBeNull();
  });
});
