import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { sourceById } from "~backend/modules/vulnerabilities/sources/registry";

const fixture = (file: string) => fileURLToPath(new URL(`./${file}`, import.meta.url));

async function importAll(sourceId: string, file: string) {
  const source = sourceById(sourceId);
  if (!source) throw new Error(`No source ${sourceId}`);
  const records = [];
  for await (const record of source.importFile(fixture(file), new AbortController().signal)) {
    records.push(record);
  }
  return records;
}

describe("demo vulnerability slice", () => {
  it("parses every NVD record, with criteria for the demo software", async () => {
    const raw = JSON.parse(await readFile(fixture("nvd.json"), "utf8")) as {
      vulnerabilities: unknown[];
    };
    const records = await importAll("nvd", "nvd.json");
    expect(records).toHaveLength(raw.vulnerabilities.length);
    expect(records.map((record) => record.externalId)).toContain("CVE-2014-9222");
    expect(records.every((record) => record.criteria.length > 0)).toBe(true);
  });

  it("parses every OSV record", async () => {
    const raw = JSON.parse(await readFile(fixture("osv.json"), "utf8")) as unknown[];
    const records = await importAll("osv", "osv.json");
    expect(records).toHaveLength(raw.length);
    expect(records.some((record) => record.externalId.startsWith("DEBIAN-CVE-"))).toBe(true);
  });
});
