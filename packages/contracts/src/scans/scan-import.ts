import { z } from "zod";

import {
  cidrToRange,
  ipv4ToInt,
  mergeRanges,
  parseCidr,
  rangeSize,
  type Ipv4Range,
} from "../targets/ipv4";
import {
  WorkerResultSchema,
  type ObservedHost,
  type WorkerResult,
} from "../workers/worker-result.schema";
import type { ScanStatus } from "./scans.schema";
import {
  SCAN_EXPORT_FORMAT,
  SCAN_EXPORT_VERSION,
  ScanExportDocumentSchema,
  type ScanEdits,
} from "./scan-export.schema";

// Reads a results file for `POST /scans/import`. The import page runs it for the preview and
// the backend runs the same code on the uploaded file, so what the preview shows is what the
// API accepts. No Node- or DOM-only APIs here.

export const SCAN_IMPORT_LIMITS = {
  /** Request body limit and the import page's file check. */
  maxFileBytes: 64 * 1024 * 1024,
  maxAddresses: 2 ** 20,
  /** Each one is several writes inside the import's transaction. */
  maxUpHosts: 20_000,
  maxWorkerResults: 4096,
  /** Enough to point at the problem without listing every row of a broken file. */
  maxReportedIssues: 100,
} as const;

/** What the file turned out to be. */
export const ScanImportFormatSchema = z.enum(["subsurf-scan", "worker-results", "csv"]);

export const ScanImportIssueCodeSchema = z.enum([
  // the file as a whole
  "not_json",
  "unknown_format",
  "unsupported_version",
  "invalid_document",
  "invalid_result",
  "multiple_scans",
  "duplicate_address",
  "nothing_to_import",
  "too_many_addresses",
  "too_many_up_hosts",
  "too_many_results",
  // skipped parts
  "empty_result",
]);

export const ScanImportIssueSchema = z.object({
  code: ScanImportIssueCodeSchema,
  /** The result's index in the file, or the CSV line; `null` for the file as a whole. */
  position: z.number().int().nonnegative().nullable(),
  /** What exactly, e.g. the address or the schema's message. Not translated. */
  detail: z.string(),
});

export type ScanImportFormat = z.infer<typeof ScanImportFormatSchema>;
export type ScanImportIssueCode = z.infer<typeof ScanImportIssueCodeSchema>;
export type ScanImportIssue = z.infer<typeof ScanImportIssueSchema>;

/** What a file says about the scan itself; `null` = not recorded. */
export interface ImportedScanFacts {
  name: string | null;
  status: "completed" | "stopped" | "failed";
  /** Where the scan sits among the others. */
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  ports: string | null;
  maxRate: number | null;
}

/** A results file in one of two shapes, whatever it was written as. */
export type ScanImport =
  | {
      inputFormat: "worker-results";
      /** Replayed as they are: each keeps its worker, timing and parameters. */
      results: WorkerResult[];
    }
  | {
      inputFormat: "subsurf-scan" | "csv";
      scan: ImportedScanFacts;
      /** An address inside these blocks without an entry in `hosts` is `down`. */
      coverage: string[];
      hosts: ObservedHost[];
      edits: ScanEdits;
    };

export type ScanImportRead =
  | { ok: true; import: ScanImport; warnings: ScanImportIssue[] }
  | { ok: false; errors: ScanImportIssue[] };

const failed = (code: ScanImportIssueCode, detail = "", position: number | null = null): ScanImportRead => ({
  ok: false,
  errors: [{ code, position, detail }],
});

const schemaIssues = (
  code: ScanImportIssueCode,
  error: z.ZodError,
  position: number | null,
): ScanImportIssue[] =>
  error.issues.slice(0, SCAN_IMPORT_LIMITS.maxReportedIssues).map((issue) => ({
    code,
    position,
    detail: `${issue.path.join(".") || "(file)"}: ${issue.message}`,
  }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function blockRange(block: string): Ipv4Range {
  if (block.includes("/")) return cidrToRange(parseCidr(block));
  const address = ipv4ToInt(block);
  return { start: address, end: address };
}

/** The addresses the import covers: the listed blocks and every listed host, merged. */
export function importedRanges(coverage: readonly string[], hosts: readonly ObservedHost[]): Ipv4Range[] {
  return mergeRanges([
    ...coverage.map(blockRange),
    ...hosts.map((host) => blockRange(host.ip)),
  ]);
}

function firstDuplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  return values.find((value) => seen.size === seen.add(value).size);
}

// A scan exported while it ran: what the file holds is all there will be of it.
const finalStatus = (status: ScanStatus): ImportedScanFacts["status"] =>
  status === "stopped" || status === "failed" ? status : "completed";

function readDocument(data: Record<string, unknown>): ScanImportRead {
  if (data.version !== SCAN_EXPORT_VERSION) return failed("unsupported_version", String(data.version));
  const parsed = ScanExportDocumentSchema.safeParse(data);
  if (!parsed.success) return { ok: false, errors: schemaIssues("invalid_document", parsed.error, null) };
  const { scan, coverage, hosts, edits } = parsed.data;
  const duplicate = firstDuplicate(hosts.map((host) => host.ip));
  if (duplicate) return failed("duplicate_address", duplicate);
  return checked(
    {
      inputFormat: "subsurf-scan",
      scan: {
        name: scan.name || null,
        status: finalStatus(scan.status),
        createdAt: scan.createdAt,
        startedAt: scan.startedAt,
        finishedAt: scan.finishedAt,
        ports: scan.ports,
        maxRate: scan.maxRate > 0 ? scan.maxRate : null,
      },
      coverage,
      hosts,
      edits,
    },
    [],
  );
}

function readWorkerResults(items: readonly unknown[]): ScanImportRead {
  if (items.length > SCAN_IMPORT_LIMITS.maxWorkerResults) {
    return failed("too_many_results", String(items.length));
  }
  const results: WorkerResult[] = [];
  const warnings: ScanImportIssue[] = [];
  for (const [index, item] of items.entries()) {
    const parsed = WorkerResultSchema.safeParse(item);
    if (!parsed.success) return { ok: false, errors: schemaIssues("invalid_result", parsed.error, index) };
    if (parsed.data.hosts.length === 0) {
      warnings.push({ code: "empty_result", position: index, detail: parsed.data.scan.jobId });
    } else {
      results.push(parsed.data);
    }
  }
  const scanIds = [...new Set(results.map((result) => result.scan.scanId))];
  if (scanIds.length > 1) return failed("multiple_scans", scanIds.slice(0, 3).join(", "));
  return checked({ inputFormat: "worker-results", results }, warnings);
}

/** Applies the limits; a file with nothing in it is an error, not an empty scan. */
function checked(read: ScanImport, warnings: ScanImportIssue[]): ScanImportRead {
  const { addresses, up } = summarizeScanImport(read);
  if (addresses === 0) return failed("nothing_to_import");
  if (addresses > SCAN_IMPORT_LIMITS.maxAddresses) return failed("too_many_addresses", String(addresses));
  if (up > SCAN_IMPORT_LIMITS.maxUpHosts) return failed("too_many_up_hosts", String(up));
  return { ok: true, import: read, warnings };
}

/**
 * Reads parsed JSON: the scan export document, one worker result (`{ scan, hosts }`) or a list
 * of them. Results nested one level deep are flattened, so several files can be joined.
 */
export function readScanJson(data: unknown): ScanImportRead {
  if (Array.isArray(data)) return readWorkerResults(data.flat(1));
  if (!isRecord(data)) return failed("unknown_format");
  if (data.format === SCAN_EXPORT_FORMAT) return readDocument(data);
  if ("scan" in data && "hosts" in data) return readWorkerResults([data]);
  return failed("unknown_format");
}

export function readScanJsonText(text: string): ScanImportRead {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return failed("not_json", error instanceof Error ? error.message : "");
  }
  return readScanJson(data);
}

export interface ScanImportSummary {
  /** Addresses the scan will have an answer for. */
  addresses: number;
  up: number;
  down: number;
  /** `timeout`, `cancelled` and `failed`. */
  noAnswer: number;
  openPorts: number;
  httpEndpoints: number;
  hostEdits: number;
  serviceEdits: number;
  /** When the scan ran, if the file says. */
  recordedAt: string | null;
}

/** What importing the file adds, for the preview and the limits. */
export function summarizeScanImport(read: ScanImport): ScanImportSummary {
  // Several results may report one address (worker stages): `up` wins, as in the scan view.
  const best = new Map<string, ObservedHost>();
  const hosts = read.inputFormat === "worker-results" ? read.results.flatMap((result) => result.hosts) : read.hosts;
  for (const host of hosts) {
    const known = best.get(host.ip);
    if (!known || (known.status !== "up" && host.status === "up")) best.set(host.ip, host);
  }
  const listed = [...best.values()];
  const up = listed.filter((host) => host.status === "up");
  const explicitDown = listed.filter((host) => host.status === "down").length;
  const addresses =
    read.inputFormat === "worker-results"
      ? listed.length
      : importedRanges(read.coverage, read.hosts).reduce((sum, range) => sum + rangeSize(range), 0);
  const ports = up.flatMap((host) => host.ports);
  const startedAt =
    read.inputFormat === "worker-results"
      ? (read.results.map((result) => result.scan.startedAt).toSorted()[0] ?? null)
      : (read.scan.createdAt ?? read.scan.startedAt);
  return {
    addresses,
    up: up.length,
    down: addresses - (listed.length - explicitDown),
    noAnswer: listed.length - up.length - explicitDown,
    openPorts: ports.length,
    httpEndpoints: ports.reduce((sum, port) => sum + port.http.length, 0),
    hostEdits: read.inputFormat === "worker-results" ? 0 : read.edits.hosts.length,
    serviceEdits: read.inputFormat === "worker-results" ? 0 : read.edits.services.length,
    recordedAt: startedAt,
  };
}
