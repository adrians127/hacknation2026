import { describe, expect, it } from "vitest";

import {
  readScanCsv,
  readScanJson,
  summarizeScanImport,
} from "@subsurf/contracts/scans/scan-import";

import sampleCsv from "../../../../public/samples/scan-results.csv?raw";
import sampleJson from "../../../../public/samples/scan-results.json";

// The files the import page links to: they must stay importable as the formats evolve.
describe("sample result files", () => {
  const expected = { addresses: 17, up: 2, down: 14, noAnswer: 1, openPorts: 3, hostEdits: 1, serviceEdits: 1 };

  it("reads the JSON sample as a scan export", () => {
    const read = readScanJson(sampleJson);

    expect(read).toMatchObject({ ok: true, import: { inputFormat: "subsurf-scan" }, warnings: [] });
    expect(read.ok && summarizeScanImport(read.import)).toMatchObject(expected);
  });

  it("reads the CSV sample to the same hosts", () => {
    const read = readScanCsv(sampleCsv);

    expect(read).toMatchObject({ ok: true, import: { inputFormat: "csv" }, warnings: [] });
    expect(read.ok && summarizeScanImport(read.import)).toMatchObject(expected);
  });
});
