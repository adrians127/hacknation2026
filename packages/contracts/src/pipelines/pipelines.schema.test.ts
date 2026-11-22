import { describe, expect, it } from "vitest";

import {
  PipelineBodySchema,
  ScheduleSchema,
  UpdatePipelineBodySchema,
  type PipelineBody,
  type PipelineStep,
  type Schedule,
} from "./pipelines.schema";

const schedule: Schedule = {
  every: 1,
  unit: "day",
  startsAt: "2026-11-23T01:00",
  daysOfWeek: [1, 2, 3, 4, 5],
  windowMinutes: 240,
  timezone: "Europe/Warsaw",
};

const step: PipelineStep = {
  workerId: "0193a0f2-1b2c-7d3e-8f40-516273849506",
  input: "targets",
  ports: "22,80,443",
  rate: 1000,
  batchSize: 256,
  maxDurationSeconds: 3600,
  split: { strategy: "none" },
  params: {},
};

const body: PipelineBody = {
  name: "Nightly",
  description: "",
  enabled: true,
  targets: { tags: ["campus"], targetIds: [], ranges: ["10.40.0.0/18"] },
  steps: [step, { ...step, input: "previous" }],
  schedule,
};

describe("ScheduleSchema", () => {
  it("accepts a weekday schedule with a window", () => {
    expect(ScheduleSchema.safeParse(schedule).success).toBe(true);
  });

  it("rejects a window longer than the interval, a bad time zone or start", () => {
    expect(ScheduleSchema.safeParse({ ...schedule, unit: "hour", windowMinutes: 61 }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...schedule, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(ScheduleSchema.safeParse({ ...schedule, startsAt: "2026-11-23 01:00" }).success).toBe(false);
  });
});

describe("PipelineBodySchema", () => {
  it("accepts a masscan → nmap chain", () => {
    expect(PipelineBodySchema.safeParse(body).success).toBe(true);
  });

  it("requires the first step to scan the targets", () => {
    const result = PipelineBodySchema.safeParse({ ...body, steps: [{ ...step, input: "previous" }] });
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["steps", 0, "input"]]);
  });

  it("enables only a scheduled pipeline", () => {
    expect(PipelineBodySchema.safeParse({ ...body, schedule: null }).success).toBe(false);
    expect(PipelineBodySchema.safeParse({ ...body, schedule: null, enabled: false }).success).toBe(true);
  });

  it("rejects batch sizes that are not a power of two from 16 to 1024", () => {
    for (const batchSize of [8, 100, 2048]) {
      expect(PipelineBodySchema.safeParse({ ...body, steps: [{ ...step, batchSize }] }).success).toBe(false);
    }
  });
});

describe("UpdatePipelineBodySchema", () => {
  it("takes any subset but not nothing", () => {
    expect(UpdatePipelineBodySchema.safeParse({ enabled: false }).success).toBe(true);
    expect(UpdatePipelineBodySchema.safeParse({}).success).toBe(false);
  });
});
