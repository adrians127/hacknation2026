import { describe, expect, it } from "vitest";

import {
  BUILTIN_WORKERS,
  defaultStepParams,
  validateStepParams,
  WorkerParamFieldsSchema,
} from "./worker-catalog";

const nmap = BUILTIN_WORKERS.find((worker) => worker.name === "nmap");
const masscan = BUILTIN_WORKERS.find((worker) => worker.name === "masscan");
if (!nmap || !masscan) throw new Error("The catalog has masscan and nmap");

describe("BUILTIN_WORKERS", () => {
  it("has valid, unique fields that never use a key the backend sets", () => {
    for (const worker of BUILTIN_WORKERS) {
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
    for (const worker of BUILTIN_WORKERS) {
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
  it("prefers the admin's defaults over the fields' own", () => {
    expect(defaultStepParams(masscan.paramFields, { wait_seconds: 10 })).toEqual({
      wait_seconds: 10,
      retries: 0,
    });
  });
});
