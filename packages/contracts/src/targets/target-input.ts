import { z } from "zod";

import {
  cidrSize,
  cidrToRange,
  formatCidr,
  intToIpv4,
  ipv4ToInt,
  mergeRanges,
  overlapsReserved,
  parseCidr,
  rangeSize,
  rangeToCidrs,
  type Ipv4Range,
} from "./ipv4";

/**
 * Turns user input (manual text, CSV, JSON) into normalized targets. Runs in the browser
 * for the live preview and again in the backend, which never trusts the client's result.
 */

export const TargetKindSchema = z.enum(["ip", "cidr", "domain"]);
export type TargetKind = z.infer<typeof TargetKindSchema>;
/** What a user can enter. A `range` is never stored: it becomes `ip`/`cidr` blocks. */
export type TargetInputKind = TargetKind | "range";

export const TARGET_IMPORT_LIMITS = {
  /** Entries in one import. */
  maxEntries: 100_000,
  /** Unique IPv4 addresses covered by the IPs and CIDRs of one import. */
  maxAddresses: 1_048_576,
  /** The backend resolves domains while it queues the scan, inside the request. */
  maxDomains: 1_000,
  /** The largest accepted CIDR is a /16, and an IP range may not cover more addresses. */
  minCidrPrefix: 16,
  /** A raw value may be a URL, so it can be longer than any normalized target. */
  maxRawValueLength: 2048,
  maxDomainLength: 253,
  maxNoteLength: 500,
  maxFileBytes: 10 * 1024 * 1024,
} as const;

/** Why an entry was skipped, or how it was changed (see `isTargetWarning`). */
export const TargetIssueCodeSchema = z.enum([
  "invalid_format",
  "ipv6_unsupported",
  "reserved_range",
  "cidr_too_large",
  "invalid_range",
  "range_too_large",
  "value_too_long",
  "note_too_long",
  "duplicate",
  "cidr_normalized",
  "single_host_cidr",
  "url_stripped",
  "range_split",
  "covered_by",
]);
export type TargetIssueCode = z.infer<typeof TargetIssueCodeSchema>;

const WARNING_CODES: ReadonlySet<TargetIssueCode> = new Set<TargetIssueCode>([
  "duplicate",
  "cidr_normalized",
  "single_host_cidr",
  "url_stripped",
  "range_split",
  "covered_by",
]);

/** A warning keeps the entry (normalized) or drops a harmless repeat; any other code rejects it. */
export function isTargetWarning(code: TargetIssueCode): boolean {
  return WARNING_CODES.has(code);
}

/** Problems with the input as a whole; any of them blocks the import. */
export const TargetListErrorCodeSchema = z.enum([
  "empty",
  "invalid_json",
  "unsupported_json_shape",
  "too_many_entries",
  "too_many_addresses",
  "too_many_domains",
]);
export type TargetListErrorCode = z.infer<typeof TargetListErrorCodeSchema>;

/** One stored target an IP range is split into. */
export interface TargetBlock {
  kind: "ip" | "cidr";
  value: string;
  range: Ipv4Range;
}

export type ParsedTargetValue =
  | { ok: true; kind: TargetKind; value: string; range: Ipv4Range | null; warnings: TargetIssueCode[] }
  | {
      ok: true;
      kind: "range";
      /** `start-end`, both full addresses. */
      value: string;
      range: Ipv4Range;
      blocks: TargetBlock[];
      warnings: TargetIssueCode[];
    }
  | { ok: false; code: TargetIssueCode };

export interface ParsedTarget {
  kind: TargetKind;
  value: string;
  note: string;
  /** Addresses the target covers; `null` for a domain (resolved later, by the backend). */
  range: Ipv4Range | null;
  /** The input row it came from; the blocks of an IP range share one. */
  position: number;
}

export interface TargetIssue {
  /** 1-based line (text) or item (JSON); the array index for an API body. */
  position: number;
  raw: string;
  code: TargetIssueCode;
  /** `covered_by`: the earlier input (normalized) that overlaps this one. */
  detail?: string;
}

export interface TargetParseResult {
  entries: ParsedTarget[];
  issues: TargetIssue[];
  listErrors: TargetListErrorCode[];
  stats: Record<TargetKind, number> & { addresses: number };
}

export interface RawTarget {
  position: number;
  value: string;
  note: string;
}

const Ipv4Schema = z.ipv4();
const Cidrv4Schema = z.cidrv4();
const Ipv6Schema = z.ipv6();
const Cidrv6Schema = z.cidrv6();
const HostnameSchema = z.hostname();

const URL_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i;
const IPV4_LIKE = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;
// `a.b.c.d-e.f.g.h` or nmap's `a.b.c.d-h`; a hyphenated domain never starts with a dotted quad.
const RANGE_PATTERN = new RegExp(String.raw`^(${IPV4_LIKE})\s*[-–]\s*(${IPV4_LIKE}|\d{1,3})$`);
const MAX_RAW_DISPLAY_LENGTH = 200;

const stripBrackets = (value: string) => value.replace(/^\[(.*)\]$/, "$1");

export function parseTargetValue(raw: string): ParsedTargetValue {
  let value = raw.trim();
  if (value === "") return { ok: false, code: "invalid_format" };
  if (value.length > TARGET_IMPORT_LIMITS.maxRawValueLength) return { ok: false, code: "value_too_long" };

  const warnings: TargetIssueCode[] = [];
  if (URL_PATTERN.test(value)) {
    const hostname = urlHostname(value);
    if (hostname === null) return { ok: false, code: "invalid_format" };
    value = hostname;
    warnings.push("url_stripped");
  }

  const range = RANGE_PATTERN.exec(value);
  if (range) return parseRangeValue(range[1] ?? "", range[2] ?? "", warnings);
  if (value.includes("/")) return parseCidrValue(value, warnings);
  if (Ipv4Schema.safeParse(value).success) {
    const address = ipv4ToInt(value);
    return addressResult("ip", intToIpv4(address), { start: address, end: address }, warnings);
  }
  if (Ipv6Schema.safeParse(stripBrackets(value)).success) return { ok: false, code: "ipv6_unsupported" };
  return parseDomain(value, warnings);
}

function urlHostname(value: string): string | null {
  try {
    return stripBrackets(new URL(value).hostname) || null;
  } catch {
    return null;
  }
}

function parseCidrValue(value: string, warnings: TargetIssueCode[]): ParsedTargetValue {
  if (!Cidrv4Schema.safeParse(value).success) {
    return { ok: false, code: Cidrv6Schema.safeParse(value).success ? "ipv6_unsupported" : "invalid_format" };
  }
  const cidr = parseCidr(value);
  if (cidr.prefix < TARGET_IMPORT_LIMITS.minCidrPrefix) return { ok: false, code: "cidr_too_large" };

  if (cidr.prefix === 32) {
    return addressResult("ip", intToIpv4(cidr.network), cidrToRange(cidr), [...warnings, "single_host_cidr"]);
  }
  const normalized = formatCidr(cidr);
  if (normalized !== value) warnings.push("cidr_normalized");
  return addressResult("cidr", normalized, cidrToRange(cidr), warnings);
}

function parseRangeValue(first: string, last: string, warnings: TargetIssueCode[]): ParsedTargetValue {
  const lastIp = last.includes(".") ? last : first.slice(0, first.lastIndexOf(".") + 1) + last;
  if (!Ipv4Schema.safeParse(first).success || !Ipv4Schema.safeParse(lastIp).success) {
    return { ok: false, code: "invalid_format" };
  }
  const range = { start: ipv4ToInt(first), end: ipv4ToInt(lastIp) };
  if (range.start > range.end) return { ok: false, code: "invalid_range" };
  if (rangeSize(range) > cidrSize(TARGET_IMPORT_LIMITS.minCidrPrefix)) {
    return { ok: false, code: "range_too_large" };
  }
  if (overlapsReserved(range)) return { ok: false, code: "reserved_range" };

  const blocks = rangeToCidrs(range).map(
    (cidr): TargetBlock => ({
      kind: cidr.prefix === 32 ? "ip" : "cidr",
      value: formatCidr(cidr),
      range: cidrToRange(cidr),
    }),
  );
  const value = `${intToIpv4(range.start)}-${intToIpv4(range.end)}`;
  return { ok: true, kind: "range", value, range, blocks, warnings: [...warnings, "range_split"] };
}

function addressResult(
  kind: TargetKind,
  value: string,
  range: Ipv4Range,
  warnings: TargetIssueCode[],
): ParsedTargetValue {
  if (overlapsReserved(range)) return { ok: false, code: "reserved_range" };
  return { ok: true, kind, value, range, warnings };
}

function parseDomain(value: string, warnings: TargetIssueCode[]): ParsedTargetValue {
  const domain = value.toLowerCase().replace(/\.$/, "");
  if (domain.length > TARGET_IMPORT_LIMITS.maxDomainLength) return { ok: false, code: "value_too_long" };
  // z.hostname() also accepts single labels ("localhost") and all-numeric names ("10.0.0.300").
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (!domain.includes(".") || /^\d+$/.test(tld) || !HostnameSchema.safeParse(domain).success) {
    return { ok: false, code: "invalid_format" };
  }
  return { ok: true, kind: "domain", value: domain, range: null, warnings };
}

const truncate = (value: string) =>
  value.length > MAX_RAW_DISPLAY_LENGTH ? `${value.slice(0, MAX_RAW_DISPLAY_LENGTH)}…` : value;

/** Validates, normalizes and deduplicates raw rows from any source; IP ranges become blocks. */
export function collectTargets(rows: Iterable<RawTarget>): TargetParseResult {
  const entries: ParsedTarget[] = [];
  const issues: TargetIssue[] = [];
  const seen = new Set<string>();
  const inputs = new Map<number, { raw: string; value: string }>();

  for (const { position, value, note } of rows) {
    const raw = truncate(value.trim());
    const parsed = parseTargetValue(value);
    if (!parsed.ok) {
      issues.push({ position, raw, code: parsed.code });
      continue;
    }
    const trimmedNote = note.trim();
    if (trimmedNote.length > TARGET_IMPORT_LIMITS.maxNoteLength) {
      issues.push({ position, raw, code: "note_too_long" });
      continue;
    }
    const targets: Omit<ParsedTarget, "note" | "position">[] =
      parsed.kind === "range" ? parsed.blocks : [parsed];
    // A range is a repeat only when every one of its blocks is already there.
    const fresh = seen.has(parsed.value) ? [] : targets.filter((target) => !seen.has(target.value));
    if (fresh.length === 0) {
      issues.push({ position, raw, code: "duplicate" });
      continue;
    }
    seen.add(parsed.value);
    inputs.set(position, { raw, value: parsed.value });
    for (const code of parsed.warnings) issues.push({ position, raw, code });
    for (const { kind, value: target, range } of fresh) {
      seen.add(target);
      entries.push({ kind, value: target, note: trimmedNote, range, position });
    }
  }

  const covered = coveredIssues(entries, inputs);
  return finish(entries, covered.length > 0 ? issues.concat(covered).toSorted(byPosition) : issues, []);
}

const byPosition = (a: TargetIssue, b: TargetIssue) => a.position - b.position;

/**
 * Entries inside another entry's addresses. Every range is a CIDR block by now, so two
 * entries either nest or do not touch, and the widest block seen so far is the container.
 */
function coveredIssues(
  entries: readonly ParsedTarget[],
  inputs: ReadonlyMap<number, { raw: string; value: string }>,
): TargetIssue[] {
  const ranged = entries
    .filter((entry): entry is ParsedTarget & { range: Ipv4Range } => entry.range !== null)
    .toSorted((a, b) => a.range.start - b.range.start || b.range.end - a.range.end);
  const issues: TargetIssue[] = [];
  const reported = new Set<string>();
  let widest: (typeof ranged)[number] | undefined;
  for (const entry of ranged) {
    if (widest && widest.range.end >= entry.range.end) {
      const detail = inputs.get(widest.position)?.value ?? widest.value;
      const key = `${entry.position}\n${detail}`;
      if (!reported.has(key)) {
        reported.add(key);
        const raw = inputs.get(entry.position)?.raw ?? entry.value;
        issues.push({ position: entry.position, raw, code: "covered_by", detail });
      }
    }
    if (!widest || entry.range.end > widest.range.end) widest = entry;
  }
  return issues;
}

function finish(
  entries: ParsedTarget[],
  issues: TargetIssue[],
  listErrors: TargetListErrorCode[],
): TargetParseResult {
  const stats = { ip: 0, cidr: 0, domain: 0, addresses: 0 };
  const ranges: Ipv4Range[] = [];
  for (const entry of entries) {
    stats[entry.kind] += 1;
    if (entry.range) ranges.push(entry.range);
  }
  stats.addresses = mergeRanges(ranges).reduce((sum, range) => sum + rangeSize(range), 0);

  const errors = [...listErrors];
  if (errors.length === 0) {
    if (entries.length === 0) errors.push("empty");
    if (entries.length > TARGET_IMPORT_LIMITS.maxEntries) errors.push("too_many_entries");
    if (stats.addresses > TARGET_IMPORT_LIMITS.maxAddresses) errors.push("too_many_addresses");
    if (stats.domain > TARGET_IMPORT_LIMITS.maxDomains) errors.push("too_many_domains");
  }
  return { entries, issues, listErrors: errors, stats };
}

const VALUE_COLUMNS = ["target", "value", "address", "host", "hostname", "ip", "cidr", "domain"];
const NOTE_COLUMNS = ["note", "label", "description", "comment"];

/** Manual input and CSV (see `splitTargetText`). */
export function parseTargetText(text: string): TargetParseResult {
  return collectTargets(splitTargetText(text));
}

/**
 * One target per line, an optional note in the next column; `position` is the 1-based line.
 * A first row naming a value column (`target`, `ip`, …) is a header and picks the columns.
 * Separator `,`, `;` or tab (detected once); `"` quotes; `#` comments and blank lines are skipped.
 */
export function splitTargetText(text: string): RawTarget[] {
  const rows: RawTarget[] = [];
  let delimiter: string | null = null;
  let columns = { value: 0, note: 1 };
  let isFirstRow = true;

  text.split(/\r\n|\n|\r/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    delimiter ??= detectDelimiter(trimmed);
    const cells = splitCsvLine(trimmed, delimiter);

    if (isFirstRow) {
      isFirstRow = false;
      const header = headerColumns(cells);
      if (header) {
        columns = header;
        return;
      }
    }
    rows.push({
      position: index + 1,
      value: cells.at(columns.value) ?? "",
      note: columns.note === -1 ? "" : (cells.at(columns.note) ?? ""),
    });
  });

  return rows;
}

function detectDelimiter(line: string): string {
  const unquoted = line.replace(/"[^"]*"/g, "");
  if (unquoted.includes("\t")) return "\t";
  if (unquoted.includes(";")) return ";";
  return ",";
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let isQuoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line.charAt(index);
    if (isQuoted) {
      if (char !== '"') cell += char;
      else if (line.charAt(index + 1) === '"') {
        cell += '"';
        index += 1;
      } else isQuoted = false;
    } else if (char === '"' && cell.trim() === "") {
      isQuoted = true;
      cell = "";
    } else if (char === delimiter) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function headerColumns(cells: string[]): { value: number; note: number } | null {
  // A data row whose note happens to read "host" must not become the header.
  if (cells.some((cell) => parseTargetValue(cell).ok)) return null;
  const names = cells.map((cell) => cell.toLowerCase());
  const value = names.findIndex((name) => VALUE_COLUMNS.includes(name));
  if (value === -1) return null;
  return { value, note: names.findIndex((name) => NOTE_COLUMNS.includes(name)) };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * JSON: an array of strings or of objects (`{ "target": "…", "note": "…" }`, also `value`,
 * `address`, `host`, …), either bare or under a `targets` key.
 */
export function parseTargetJson(text: string): TargetParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return finish([], [], ["invalid_json"]);
  }

  const items = Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.targets) ? data.targets : null;
  if (items === null) return finish([], [], ["unsupported_json_shape"]);

  const rows: RawTarget[] = [];
  const shapeIssues: TargetIssue[] = [];
  items.forEach((item: unknown, index) => {
    const position = index + 1;
    const value = typeof item === "string" ? item : isRecord(item) ? pickString(item, VALUE_COLUMNS) : undefined;
    if (value === undefined) {
      shapeIssues.push({ position, raw: truncate(JSON.stringify(item) ?? String(item)), code: "invalid_format" });
      return;
    }
    const note = isRecord(item) ? (pickString(item, NOTE_COLUMNS) ?? "") : "";
    rows.push({ position, value, note });
  });

  const result = collectTargets(rows);
  return { ...result, issues: [...shapeIssues, ...result.issues].toSorted(byPosition) };
}
