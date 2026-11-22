import { describe, expect, it } from "vitest";

import { addFromText, analyzeEntries, isRowDropped, toImportEntries, type FormEntry } from "./entry-list";

const values = (entries: readonly FormEntry[]) => entries.map((entry) => [entry.parsed.value, entry.note]);

describe("addFromText", () => {
  it("adds a single value with the note field", () => {
    const result = addFromText([], "10.0.0.5/24", " Campus ");
    expect(values(result.added)).toEqual([["10.0.0.0/24", "Campus"]]);
    expect(result).toMatchObject({ remainingText: "", problems: [], alreadyListed: 0, total: 1 });
  });

  it("keeps the lines it cannot add, as typed, with the reasons", () => {
    const text = "192.0.2.1\n  10.0.0.300  \n# comment\n\n10.0.0.1-200, Lab\n172.16.0.0/12";
    const result = addFromText([], text, "default");
    expect(values(result.added)).toEqual([
      ["192.0.2.1", "default"],
      ["10.0.0.1-10.0.0.200", "Lab"],
    ]);
    expect(result.remainingText).toBe("  10.0.0.300  \n172.16.0.0/12");
    expect(result.problems).toEqual([
      { raw: "10.0.0.300", code: "invalid_format" },
      { raw: "172.16.0.0/12", code: "cidr_too_large" },
    ]);
    expect(result.total).toBe(4);
  });

  it("skips values the list already has, after normalization", () => {
    const [existing] = addFromText([], "10.0.0.0/24", "").added;
    const result = addFromText(existing ? [existing] : [], "10.0.0.9/24\n10.0.0.9/24\n192.0.2.1", "");
    expect(values(result.added)).toEqual([["192.0.2.1", ""]]);
    expect(result.alreadyListed).toBe(2);
  });

  it("treats a lone header-like word as a typo, not a CSV header", () => {
    expect(addFromText([], "host", "")).toMatchObject({
      added: [],
      remainingText: "host",
      problems: [{ raw: "host", code: "invalid_format" }],
    });
  });

  it("still drops a real CSV header", () => {
    const result = addFromText([], "target,note\n192.0.2.1,gw", "");
    expect(values(result.added)).toEqual([["192.0.2.1", "gw"]]);
    expect(result.problems).toEqual([]);
  });
});

describe("analyzeEntries", () => {
  it("reports overlaps and fully repeated ranges per row, not the range split itself", () => {
    const { added } = addFromText([], "10.0.0.0/24\n10.0.0.7\n10.0.0.0-10.0.0.255\n10.0.1.0-10.0.1.9", "");
    const { result, rowIssues } = analyzeEntries(added);

    expect(result.entries.map((entry) => entry.value)).toEqual([
      "10.0.0.0/24",
      "10.0.0.7",
      "10.0.1.0/29",
      "10.0.1.8/31",
    ]);
    expect(rowIssues.get(2)).toMatchObject([{ code: "covered_by", detail: "10.0.0.0/24" }]);
    expect(isRowDropped(rowIssues.get(3))).toBe(true);
    expect(rowIssues.has(4)).toBe(false);
  });
});

describe("toImportEntries", () => {
  it("sends normalized values and only non-empty notes", () => {
    const { added } = addFromText([], "10.0.0.1-200, Lab\nhttps://Example.com/x", "");
    expect(toImportEntries(added)).toEqual([{ value: "10.0.0.1-10.0.0.200", note: "Lab" }, { value: "example.com" }]);
  });
});
