import { describe, expect, it } from "vitest";

import { buildWorkerResult } from "../workers/worker-result.fixture";
import { formatPortSpec, parsePortSpec, portsOutside } from "./port-spec";
import type { ScanExportDocument } from "./scan-export.schema";
import { SCAN_CSV_COLUMNS, scanCsvDownRow, scanCsvRows } from "./scan-csv";
import { readScanCsv, readScanJson, readScanJsonText, summarizeScanImport } from "./scan-import";

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

  it("fills the keys an older or hand-written file leaves out", () => {
    const { coverage: _coverage, edits: _edits, ...complete } = document();
    const older = {
      ...complete,
      hosts: [
        // Written before ports had `tls`, and by hand: only what somebody knew.
        {
          ip: "10.0.5.7",
          status: "up",
          ports: [{ port: 22 }, { port: 80, http: [{ scheme: "http", url: "http://10.0.5.7/" }] }],
        },
        { ip: "10.0.5.9", status: "timeout" },
      ],
    };

    const read = readScanJson(older);

    if (!read.ok || read.import.inputFormat !== "subsurf-scan") throw new Error("Expected a document");
    expect(read.import.coverage).toEqual([]);
    expect(read.import.edits).toEqual({ hosts: [], services: [] });
    const [host, other] = read.import.hosts;
    expect(other).toMatchObject({ status: "timeout", hostnames: [], ports: [], error: null });
    expect(host.ports[0]).toEqual({
      port: 22,
      protocol: "tcp",
      state: "open",
      reason: null,
      service: null,
      identity: { ttl: null, sshHostKeySha256: null, tlsCertSha256: null },
      banner: null,
      scripts: [],
      http: [],
      tls: [],
    });
    expect(host.ports[1].http[0]).toMatchObject({
      finalUrl: "http://10.0.5.7/",
      statusCode: null,
      headers: [],
      body: null,
    });
    // What is there is still validated.
    expect(codes(readScanJson({ ...older, hosts: [{ ip: "10.0.5.7", status: "open" }] }))).toEqual([
      "invalid_document",
    ]);
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

const line = (cells: readonly (string | number | null)[]) => cells.map((cell) => cell ?? "").join(",");

describe("readScanCsv", () => {
  it("rebuilds hosts, ports and endpoints from the rows the export writes", () => {
    const [wiki, , timedOut] = buildWorkerResult(IDS).hosts;
    const edits = {
      hosts: [{ ip: wiki.ip, triage: "important" as const, tags: ["dmz", "wiki"], note: "Public" }],
      services: [],
    };
    const rows = [...scanCsvRows(wiki, edits), ...scanCsvRows(timedOut, edits), scanCsvDownRow("10.0.5.0/28")];
    // Tags hold a comma, so the cell has to be quoted, as the export's writer does.
    const csv = [SCAN_CSV_COLUMNS.join(","), ...rows.map((row) =>
      line(SCAN_CSV_COLUMNS.map((column) => (column === "host_tags" && row[column] ? `"${row[column]}"` : row[column]))),
    )].join("\r\n");

    const read = readScanCsv(csv);

    if (!read.ok || read.import.inputFormat !== "csv") throw new Error("Expected a CSV import");
    expect(read.warnings).toEqual([]);
    expect(read.import.coverage).toEqual(["10.0.5.0/28"]);
    expect(read.import.edits).toEqual(edits);
    const [host, other] = read.import.hosts;
    expect(other).toMatchObject({ ip: "10.0.5.9", status: "timeout", ports: [] });
    expect(host).toMatchObject({ ip: "10.0.5.7", status: "up", latencyMs: 3 });
    expect(host.ports.map((port) => [port.port, port.service?.product, port.http.length])).toEqual([
      [22, "OpenSSH", 0],
      [443, "nginx", 2],
    ]);
    expect(host.ports[0].identity.sshHostKeySha256).toBe(wiki.ports[0].identity.sshHostKeySha256);
    expect(host.ports[1].http[0]).toMatchObject({
      scheme: "https",
      vhost: "wiki.example.org",
      finalUrl: "https://wiki.example.org/login",
      statusCode: 200,
      title: "Wiki – login",
    });
    expect(summarizeScanImport(read.import)).toMatchObject({ addresses: 16, up: 1, down: 14, noAnswer: 1 });
  });

  it("undoes the export's formula guard and tolerates a file with only addresses", () => {
    const guarded = readScanCsv("ip,port,service,url,title\n10.0.0.1,80,http,http://10.0.0.1/,'=SUM(A1)\n");
    const bare = readScanCsv("IP Address\n10.0.0.1\n10.0.0.2\n");

    if (!guarded.ok || guarded.import.inputFormat !== "csv") throw new Error("Expected a CSV import");
    expect(guarded.import.hosts[0].ports[0].http[0].title).toBe("=SUM(A1)");
    expect(bare.ok && summarizeScanImport(bare.import)).toMatchObject({ addresses: 2, up: 2, down: 0 });
  });

  it("warns about rows that contradict each other and rejects a file without addresses", () => {
    const read = readScanCsv("ip,status,port\n10.0.0.1,up,22\n10.0.0.1,timeout,\n10.0.0.1,down,\n");

    expect(read.ok && read.warnings).toEqual([
      { code: "conflicting_status", position: 3, detail: "10.0.0.1: up, then timeout" },
    ]);
    expect(codes(readScanCsv("host name,port\nweb,80\n"))).toEqual(["missing_ip_column"]);
    expect(codes(readScanCsv("ip,port\n"))).toEqual(["nothing_to_import"]);
    expect(codes(readScanCsv(""))).toEqual(["nothing_to_import"]);
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
