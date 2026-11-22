import { z } from "zod";

import { TagsSchema } from "../common/common.schema";
import { parseCsv } from "../common/csv";
import { AssetNoteSchema, TriageStatusSchema, type TriageStatus } from "../hosts/hosts.schema";
import {
  cidrToRange,
  ipv4ToInt,
  mergeRanges,
  parseCidr,
  rangeSize,
  type Ipv4Range,
} from "../targets/ipv4";
import {
  HostStatusSchema,
  ObservedHostSchema,
  WorkerResultSchema,
  type ObservedHost,
  type OpenPort,
  type WorkerResult,
} from "../workers/worker-result.schema";
import {
  SCAN_CSV_ALIASES,
  SCAN_CSV_COLUMNS,
  SCAN_CSV_LIST_SEPARATOR,
  type ScanCsvColumn,
} from "./scan-csv";
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
  "missing_ip_column",
  // skipped parts
  "empty_result",
  "invalid_row",
  "conflicting_status",
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

// A broken file can have a problem on every line.
const MAX_COLLECTED_WARNINGS = 1000;

// The export puts a `'` before a cell a spreadsheet would run as a formula.
const unguard = (cell: string) => (/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell);

const isIpv4 = (value: string) => z.ipv4().safeParse(value).success;
const isCidr = (value: string) => z.cidrv4().safeParse(value).success;
const SHA256_HEX = /^[0-9a-f]{64}$/;

function columnIndexes(header: readonly string[]): Map<ScanCsvColumn, number> {
  const names = header.map((name) => name.trim().toLowerCase().replaceAll(/[\s-]+/g, "_"));
  const indexes = new Map<ScanCsvColumn, number>();
  for (const column of SCAN_CSV_COLUMNS) {
    const index = names.findIndex((name) => SCAN_CSV_ALIASES[column].includes(name));
    if (index !== -1) indexes.set(column, index);
  }
  return indexes;
}

function isoOrNull(value: string): string | null {
  if (value === "") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function intOrNull(value: string, min: number, max: number): number | null {
  const number = Number(value);
  return value !== "" && Number.isInteger(number) && number >= min && number <= max ? number : null;
}

interface CellEdits {
  triage: TriageStatus;
  tags: string[];
  note: string;
}

/** The edit columns of a row; values the API would reject are dropped, not the row. */
function cellEdits(triage: string, tags: string, note: string): CellEdits {
  const tagList = [
    ...new Set(
      tags
        .split(SCAN_CSV_LIST_SEPARATOR.tags)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  return {
    triage: TriageStatusSchema.safeParse(triage.toLowerCase()).data ?? "unreviewed",
    tags: TagsSchema.safeParse(tagList).success ? tagList : [],
    note: AssetNoteSchema.safeParse(note).success ? note : "",
  };
}

const isEdited = (edit: CellEdits) => edit.triage !== "unreviewed" || edit.tags.length > 0 || edit.note !== "";

/**
 * Reads the CSV the scan export writes (`scan-csv.ts`): rows are grouped into hosts by `ip`,
 * into ports by `port` and into HTTP endpoints by `scheme` and `vhost`. Headers are matched
 * through `SCAN_CSV_ALIASES`, and only `ip` is required: a row without a status is an `up`
 * host. A `down` row marks its address, or every address of its CIDR block, as covered: `down`
 * unless other rows say otherwise. Rows that cannot be read are skipped with a warning; the
 * JSON export is the lossless format.
 */
export function readScanCsv(text: string): ScanImportRead {
  const [header, ...rows] = parseCsv(text);
  if (!header) return failed("nothing_to_import");
  const columns = columnIndexes(header);
  if (!columns.has("ip")) return failed("missing_ip_column", header.join(", ").slice(0, 200));

  const warnings: ScanImportIssue[] = [];
  const warn = (code: ScanImportIssueCode, line: number | null, detail: string) => {
    if (warnings.length < MAX_COLLECTED_WARNINGS) warnings.push({ code, position: line, detail });
  };
  const hosts = new Map<string, ObservedHost>();
  const coverage: string[] = [];
  const edits: ScanEdits = { hosts: [], services: [] };

  for (const [index, row] of rows.entries()) {
    // The header is line 1.
    const line = index + 2;
    const cell = (column: ScanCsvColumn) => {
      const position = columns.get(column);
      return position === undefined ? "" : unguard((row[position] ?? "").trim());
    };

    const ip = cell("ip");
    const status = HostStatusSchema.safeParse(cell("status").toLowerCase() || "up").data;
    if (!status) {
      warn("invalid_row", line, `status: ${cell("status")}`);
      continue;
    }
    if (isCidr(ip) && status !== "down") {
      warn("invalid_row", line, `ip: only a down row may name a block (${ip})`);
      continue;
    }
    if (!isCidr(ip) && !isIpv4(ip)) {
      warn("invalid_row", line, `ip: ${ip}`);
      continue;
    }
    // A down row only says the address was covered: one with rows of its own keeps their status.
    if (status === "down") {
      coverage.push(ip);
      continue;
    }

    let host = hosts.get(ip);
    if (!host) {
      const names = [...new Set(cell("hostnames").split(/[\s,;|]+/).filter(Boolean))];
      host = {
        ip,
        status,
        reason: null,
        observedAt: isoOrNull(cell("observed_at")),
        latencyMs: intOrNull(cell("latency_ms"), 0, Number.MAX_SAFE_INTEGER),
        // Where a name came from is not in the file.
        hostnames: names.map((name) => ({ name, source: "ptr" })),
        error: null,
        ports: [],
      };
      hosts.set(ip, host);
      const edit = cellEdits(cell("host_triage"), cell("host_tags"), cell("host_note"));
      if (isEdited(edit)) edits.hosts.push({ ip, ...edit });
    } else if (host.status !== status) {
      warn("conflicting_status", line, `${ip}: ${host.status}, then ${status}`);
      continue;
    }

    if (cell("port") === "") continue;
    const number = intOrNull(cell("port"), 1, 65535);
    const protocol = cell("protocol").toLowerCase() || "tcp";
    if (number === null || protocol !== "tcp") {
      warn("invalid_row", line, number === null ? `port: ${cell("port")}` : `protocol: ${protocol}`);
      continue;
    }
    if (host.status !== "up") {
      warn("invalid_row", line, `port: ${ip} is ${host.status}, so it has no open ports`);
      continue;
    }

    let port: OpenPort | undefined = host.ports.find((candidate) => candidate.port === number);
    if (!port) {
      const [name, product, version] = [cell("service"), cell("product"), cell("version")];
      const sshHostKey = cell("ssh_host_key").toLowerCase();
      port = {
        port: number,
        protocol: "tcp",
        state: "open",
        reason: null,
        service:
          name || product || version
            ? {
                name: name || "unknown",
                product: product || null,
                version: version || null,
                extraInfo: cell("extra_info") || null,
                cpe: cell("cpe").split(/\s+/).filter(Boolean),
                method: "table",
                confidence: 0,
              }
            : null,
        identity: {
          ttl: null,
          sshHostKeySha256: SHA256_HEX.test(sshHostKey) ? sshHostKey : null,
          tlsCertSha256: null,
        },
        banner: null,
        scripts: [],
        http: [],
      };
      host.ports.push(port);
      const edit = cellEdits(cell("service_triage"), cell("service_tags"), cell("service_note"));
      const overrides = {
        nameOverride: cell("name_override").slice(0, 200) || null,
        productOverride: cell("product_override").slice(0, 200) || null,
        versionOverride: cell("version_override").slice(0, 200) || null,
      };
      if (isEdited(edit) || Object.values(overrides).some((value) => value !== null)) {
        edits.services.push({ ip, protocol: "tcp", port: number, ...edit, ...overrides });
      }
    }

    const url = cell("url");
    const scheme = cell("scheme").toLowerCase() || url.slice(0, url.indexOf(":")).toLowerCase();
    if (scheme === "" && url === "") continue;
    if (scheme !== "http" && scheme !== "https") {
      warn("invalid_row", line, `scheme: ${scheme}`);
      continue;
    }
    const vhost = cell("vhost") || null;
    if (port.http.some((endpoint) => endpoint.scheme === scheme && endpoint.vhost === vhost)) {
      warn("invalid_row", line, `endpoint: ${scheme}://${vhost ?? ip}:${number} appears twice`);
      continue;
    }
    const firstUrl = url || `${scheme}://${vhost ?? ip}:${number}/`;
    port.http.push({
      scheme,
      vhost,
      url: firstUrl,
      finalUrl: cell("final_url") || firstUrl,
      statusCode: intOrNull(cell("status_code"), 100, 599),
      title: cell("title") || null,
      headers: [],
      cookies: [],
      redirects: [],
      body: null,
      favicon: null,
      tls: null,
      probes: [],
      error: null,
    });
  }

  // What the columns could not express correctly (a bad URL, an overlong name) fails here.
  const valid = [...hosts.values()].filter((host) => {
    const parsed = ObservedHostSchema.safeParse(host);
    if (!parsed.success) {
      const [issue] = parsed.error.issues;
      warn("invalid_row", null, `${host.ip}: ${issue?.path.join(".")}: ${issue?.message}`);
    }
    return parsed.success;
  });
  const kept = new Set(valid.map((host) => host.ip));
  const observed = valid.flatMap((host) => (host.observedAt === null ? [] : [host.observedAt])).toSorted();
  return checked(
    {
      inputFormat: "csv",
      scan: {
        name: null,
        status: "completed",
        createdAt: observed[0] ?? null,
        startedAt: observed[0] ?? null,
        finishedAt: observed.at(-1) ?? null,
        ports: null,
        maxRate: null,
      },
      coverage,
      hosts: valid,
      edits: {
        hosts: edits.hosts.filter((edit) => kept.has(edit.ip)),
        services: edits.services.filter((edit) => kept.has(edit.ip)),
      },
    },
    warnings,
  );
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
