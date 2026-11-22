import {
  collectTargets,
  isTargetWarning,
  parseTargetValue,
  splitTargetText,
  TARGET_IMPORT_LIMITS,
  type ParsedTargetValue,
  type TargetIssue,
  type TargetIssueCode,
  type TargetParseResult,
} from "@subsurf/contracts/targets/target-input";

export type ParsedEntry = Extract<ParsedTargetValue, { ok: true }>;

/** One row of the entry form's list; `parsed.value` (normalized) is unique within the list. */
export interface FormEntry {
  parsed: ParsedEntry;
  note: string;
}

export interface EntryProblem {
  raw: string;
  code: TargetIssueCode;
}

export interface AddResult {
  added: FormEntry[];
  /** The lines that could not be added, as typed, for the user to fix. */
  remainingText: string;
  problems: EntryProblem[];
  /** Values skipped because the list already has them. */
  alreadyListed: number;
  /** Targets read from the text (blank lines and comments do not count). */
  total: number;
}

/**
 * Reads the entry field like the text tab does (one target per line, `value, note`), so a
 * pasted CSV keeps its notes. The note field applies to lines without a note of their own.
 */
export function addFromText(entries: readonly FormEntry[], text: string, note: string): AddResult {
  const lines = text.split(/\r\n|\n|\r/);
  const rows = splitTargetText(text);
  const listed = new Set(entries.map((entry) => entry.parsed.value));
  const result: AddResult = { added: [], remainingText: "", problems: [], alreadyListed: 0, total: rows.length };
  const kept: string[] = [];

  const reject = (line: string, raw: string, code: TargetIssueCode) => {
    result.problems.push({ raw, code });
    kept.push(line);
  };

  // A lone word such as "host" reads as a CSV header and yields no rows; it is a typo here.
  const meaningful = lines.filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  if (rows.length === 0 && meaningful.length === 1) {
    const [line = ""] = meaningful;
    reject(line, line.trim(), "invalid_format");
    return { ...result, total: 1, remainingText: line };
  }

  for (const row of rows) {
    const line = lines[row.position - 1] ?? row.value;
    const raw = row.value.trim();
    const parsed = parseTargetValue(row.value);
    if (!parsed.ok) {
      reject(line, raw, parsed.code);
      continue;
    }
    const entryNote = row.note.trim() || note.trim();
    if (entryNote.length > TARGET_IMPORT_LIMITS.maxNoteLength) {
      reject(line, raw, "note_too_long");
      continue;
    }
    if (listed.has(parsed.value)) {
      result.alreadyListed += 1;
      continue;
    }
    listed.add(parsed.value);
    result.added.push({ parsed, note: entryNote });
  }
  return { ...result, remainingText: kept.join("\n") };
}

export interface EntryAnalysis {
  /** What the API will receive: ranges split, repeats dropped, limits checked. */
  result: TargetParseResult;
  /** Per list position (1-based, in insertion order): what is worth showing next to the row. */
  rowIssues: ReadonlyMap<number, TargetIssue[]>;
}

/** `range_split` is plain from the row itself; everything else the parser says is shown. */
const isRowIssue = (issue: TargetIssue) => issue.code !== "range_split";

export function analyzeEntries(entries: readonly FormEntry[]): EntryAnalysis {
  const result = collectTargets(
    entries.map((entry, index) => ({ position: index + 1, value: entry.parsed.value, note: entry.note })),
  );
  const rowIssues = new Map<number, TargetIssue[]>();
  for (const issue of result.issues.filter(isRowIssue)) {
    rowIssues.set(issue.position, [...(rowIssues.get(issue.position) ?? []), issue]);
  }
  return { result, rowIssues };
}

/** A row that will not be imported (e.g. a range whose blocks are all listed already). */
export const isRowDropped = (issues: readonly TargetIssue[] | undefined) =>
  issues?.some((issue) => !isTargetWarning(issue.code) || issue.code === "duplicate") ?? false;

/** Ranges go as typed (normalized): the backend splits them exactly as the preview did. */
export const toImportEntries = (entries: readonly FormEntry[]) =>
  entries.map(({ parsed, note }) => (note ? { value: parsed.value, note } : { value: parsed.value }));
