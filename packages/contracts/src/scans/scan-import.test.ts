import { describe, expect, it } from "vitest";

import { buildWorkerResult } from "../workers/worker-result.fixture";
import { formatPortSpec, parsePortSpec, portsOutside } from "./port-spec";
import type { ScanExportDocument } from "./scan-export.schema";
import { readScanJson, readScanJsonText, summarizeScanImport } from "./scan-import";

const IDS = {
  scanId: "0193a000-0000-7000-8000-000000000001",
  jobId: "0193a000-0000-7000-8000-000000000002",
  leaseId: "lease-1",
};

function document(overrides: Partial<ScanExportDocument> = {}): ScanExportDocument {
  return {
    format: "subsurf-scan",
    version: 1,
    exportedAt: "2026-11-22T00:00:00.000Z",
    scan: {
      id: IDS.scanId,
      name: "Lab",
      status: "running",
      createdAt: "2026-11-10T01:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      ports: "22,443",
      maxRate: 0,
      counts: { addresses: 0, up: 0, down: 0, timeout: 0, cancelled: 0, failed: 0, openPorts: 0 },
    },
    coverage: ["10.0.5.0/28"],
    hosts: buildWorkerResult(IDS).hosts,
    edits: { hosts: [], services: [] },
    ...overrides,
  };
}

const codes = (read: ReturnType<typeof readScanJson>) =>
  read.ok ? [] : read.errors.map((issue) => issue.code);

describe("readScanJson", () => {
  it("reads a scan export, taking an unfinished scan as all there is of it", () => {
    const read = readScanJson(document());

    if (!read.ok || read.import.inputFormat !== "subsurf-scan") throw new Error("Expected a document");
    expect(read.import.scan).toEqual({
      name: "Lab",
      status: "completed",
      createdAt: "2026-11-10T01:00:00.000Z",
      startedAt: null,
      finishedAt: null,
      ports: "22,443",
      maxRate: null,
    });
    // 16 covered addresses plus 10.0.5.200; .7 is up, .9 timed out and .200 was cancelled.
    expect(summarizeScanImport(read.import)).toMatchObject({
      addresses: 17,
      up: 1,
      down: 14,
      noAnswer: 2,
      openPorts: 2,
      httpEndpoints: 2,
      recordedAt: "2026-11-10T01:00:00.000Z",
    });
  });

  it("reads one worker result, a list and a list of lists, skipping empty results", () => {
    const result = buildWorkerResult(IDS);
    const empty = { ...buildWorkerResult(IDS), hosts: [] };

    for (const file of [result, [result], [[result], [empty]]]) {
      const read = readScanJson(file);
      if (!read.ok || read.import.inputFormat !== "worker-results") throw new Error("Expected results");
      expect(read.import.results).toHaveLength(1);
      expect(summarizeScanImport(read.import)).toMatchObject({ addresses: 4, up: 1, down: 1, noAnswer: 2 });
    }
    const read = readScanJson([result, empty]);
    expect(read.ok && read.warnings).toEqual([{ code: "empty_result", position: 1, detail: IDS.jobId }]);
  });

  it("says why a file cannot be imported", () => {
    const other = buildWorkerResult({ ...IDS, scanId: "0193a000-0000-7000-8000-000000000009" });
    const [wiki] = buildWorkerResult(IDS).hosts;

    expect(codes(readScanJsonText("{not json"))).toEqual(["not_json"]);
    expect(codes(readScanJson("text"))).toEqual(["unknown_format"]);
    expect(codes(readScanJson({ targets: [] }))).toEqual(["unknown_format"]);
    expect(codes(readScanJson({ ...document(), version: 2 }))).toEqual(["unsupported_version"]);
    expect(codes(readScanJson(document({ hosts: [wiki, wiki] })))).toEqual(["duplicate_address"]);
    expect(codes(readScanJson(document({ hosts: [], coverage: [] })))).toEqual(["nothing_to_import"]);
    expect(codes(readScanJson(document({ coverage: ["10.0.0.0/11"] })))).toEqual(["too_many_addresses"]);
    expect(codes(readScanJson([buildWorkerResult(IDS), other]))).toEqual(["multiple_scans"]);
    expect(codes(readScanJson([{ ...other, hosts: "none" }]))).toEqual(["invalid_result"]);
    expect(codes(readScanJson({ ...document(), coverage: ["10.0.5.300"] }))).toEqual(["invalid_document"]);
  });
});

describe("port specs", () => {
  it("merges overlapping and adjacent runs into a normalized spec", () => {
    const ranges = [...parsePortSpec("8000-8100,22,443"), { from: 23, to: 23 }, { from: 8050, to: 8200 }];

    expect(formatPortSpec(ranges)).toBe("22-23,443,8000-8200");
    expect(formatPortSpec([])).toBeNull();
    expect(portsOutside(parsePortSpec("22,8000-8100"), [22, 80, 8100, 8101])).toEqual([80, 8101]);
  });
});
