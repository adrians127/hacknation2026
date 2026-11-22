import { describe, expect, it } from "vitest";

import { ManagerJobSchema } from "@subsurf/contracts/workers/workers.schema";

import type { Scan, ScanJob } from "~backend/generated/prisma/client";
import { leaseJob, utcSeconds } from "~backend/modules/pipelines/manager-job";
import { defaultSteps } from "~backend/modules/pipelines/steps";

const NOW = new Date("2026-11-22T10:00:00.250Z");

function scanRow(overrides: Partial<Scan> = {}): Scan {
  return {
    id: "0193a0f2-1b2c-7d3e-8f40-516273849506",
    status: "running",
    name: "",
    note: null,
    importKey: null,
    pipelineId: null,
    trigger: "manual",
    steps: defaultSteps(),
    windowEndsAt: null,
    ports: "22,80,443",
    maxRate: 100,
    batchSize: 256,
    targetCount: 1,
    addressCount: 256,
    jobCount: 1,
    warnings: null,
    requestedById: "0193a0f2-1b2c-7d3e-8f40-000000000001",
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    updatedAt: NOW,
    ...overrides,
  };
}

function jobRow(scan: Scan, overrides: Partial<ScanJob> = {}): ScanJob {
  return {
    id: "0193a1ad-3333-7000-8000-000000000003",
    scanId: scan.id,
    sequence: 1,
    stepIndex: 1,
    worker: "masscan",
    kind: "discovery",
    status: "queued",
    subnet: "10.0.5.0/24",
    targets: ["10.0.5.0/24"],
    hosts: [],
    addressCount: 256,
    params: { targets: ["10.0.5.0/24"], ports: "22,80,443", rate: 100, wait_seconds: 3, retries: 0 },
    attempts: 0,
    leaseId: null,
    leasedBy: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    error: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("leaseJob", () => {
  it("builds a job list entry worker-manager accepts", () => {
    const scan = scanRow();
    const { job, deadline } = leaseJob(jobRow(scan), scan, NOW);

    expect(ManagerJobSchema.parse(job)).toEqual(job);
    expect(job).toMatchObject({
      worker: "masscan",
      split: { strategy: "none" },
      deadline: "2026-11-22T11:00:00Z",
      params: { targets: ["10.0.5.0/24"], max_duration_seconds: 3600, wait_seconds: 3, retries: 0 },
    });
    expect(deadline.getTime() - NOW.getTime()).toBe(3600 * 1000);
  });

  it("cuts the deadline at the scan's time window", () => {
    const scan = scanRow({ windowEndsAt: new Date("2026-11-22T10:20:00Z") });
    const { job } = leaseJob(jobRow(scan), scan, NOW);

    expect(job.deadline).toBe("2026-11-22T10:20:00Z");
    expect(job.params.max_duration_seconds).toBe(1199);
  });

  it("builds params from the scan for jobs queued before pipelines", () => {
    const scan = scanRow({ steps: [] });
    const { job } = leaseJob(jobRow(scan, { params: {} }), scan, NOW);

    expect(job.params).toMatchObject({ targets: ["10.0.5.0/24"], ports: "22,80,443", rate: 100 });
  });
});

describe("utcSeconds", () => {
  it("drops the milliseconds", () => {
    expect(utcSeconds(NOW)).toBe("2026-11-22T10:00:00Z");
  });
});
