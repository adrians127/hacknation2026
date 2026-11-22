import { describe, expect, it } from "vitest";

import {
  defaultStepParams,
  validateStepParams,
  WorkerParamFieldsSchema,
  type WorkerParamField,
} from "./worker-catalog";

// Workers are registered from their manifests (apps/workers/*/manifest.json); these mirror two of them.
const masscan: { paramFields: WorkerParamField[] } = {
  paramFields: [
    { key: "wait_seconds", label: "Wait for replies", type: "integer", min: 0, max: 60, unit: "seconds", default: 3 },
    { key: "retries", label: "Retries", type: "integer", min: 0, max: 5, default: 0 },
  ],
};
const nmap: { paramFields: WorkerParamField[] } = {
  paramFields: [{ key: "probe_paths", label: "HTTP paths to probe", type: "paths", maxItems: 128, default: [] }],
};
const WORKERS = [masscan, nmap];

describe("WorkerParamFieldsSchema", () => {
  it("has valid, unique fields that never use a key the backend sets", () => {
    for (const worker of WORKERS) {
      expect(WorkerParamFieldsSchema.safeParse(worker.paramFields).success).toBe(true);
    }
    expect(
      WorkerParamFieldsSchema.safeParse([
        { key: "rate", label: "Rate", type: "integer", min: 1, max: 2 },
      ]).success,
    ).toBe(false);
  });
});

describe("validateStepParams", () => {
  it("accepts the defaults", () => {
    for (const worker of WORKERS) {
      expect(validateStepParams(worker.paramFields, defaultStepParams(worker.paramFields))).toEqual([]);
    }
  });

  it("reports unknown keys, wrong types, ranges and unsafe paths", () => {
    expect(
      validateStepParams(masscan.paramFields, {
        wait_seconds: 61,
        retries: "2",
        shard: { index: 1 },
      }),
    ).toEqual([
      { key: "wait_seconds", code: "range" },
      { key: "retries", code: "type" },
      { key: "shard", code: "unknown" },
    ]);
    expect(validateStepParams(nmap.paramFields, { probe_paths: ["/admin", "//evil"] })).toEqual([
      { key: "probe_paths", code: "path" },
    ]);
    expect(
      validateStepParams(nmap.paramFields, { probe_paths: Array.from({ length: 129 }, () => "/a") }),
    ).toEqual([{ key: "probe_paths", code: "too_long" }]);
  });
});

describe("defaultStepParams", () => {
  it("takes each field's own default", () => {
    expect(defaultStepParams(masscan.paramFields)).toEqual({ wait_seconds: 3, retries: 0 });
  });
});
