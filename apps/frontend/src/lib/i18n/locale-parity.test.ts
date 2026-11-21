import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "locales");

// i18next plural suffixes differ per language (pl: one/few/many/other, en: one/other).
const PLURAL_SUFFIX_RE = /_(zero|one|two|few|many|other)$/;
const EXPECTED_PLURALS = { pl: ["few", "many", "one", "other"], en: ["one", "other"] } as const;

type Json = { [key: string]: Json | string };

function namespaceFiles(lang: string): string[] {
  return readdirSync(path.join(localesDir, lang))
    .filter((name) => name.endsWith(".json"))
    .toSorted();
}

function flatten(value: Json, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" ? flatten(child, full) : [full];
  });
}

function classify(paths: string[]) {
  const plain = new Set<string>();
  const plurals = new Map<string, Set<string>>();
  for (const leaf of paths) {
    const match = PLURAL_SUFFIX_RE.exec(leaf);
    if (!match?.[1]) {
      plain.add(leaf);
      continue;
    }
    const base = leaf.slice(0, match.index);
    plurals.set(base, (plurals.get(base) ?? new Set()).add(match[1]));
  }
  return { plain, plurals };
}

function load(lang: string, file: string) {
  return classify(flatten(JSON.parse(readFileSync(path.join(localesDir, lang, file), "utf8"))));
}

describe("locale parity (pl ↔ en)", () => {
  it("declares the same namespace files", () => {
    expect(namespaceFiles("en")).toEqual(namespaceFiles("pl"));
  });

  for (const file of namespaceFiles("pl")) {
    it(`has the same keys in ${file}`, () => {
      const pl = load("pl", file);
      const en = load("en", file);

      expect([...en.plain].toSorted()).toEqual([...pl.plain].toSorted());
      expect([...en.plurals.keys()].toSorted()).toEqual([...pl.plurals.keys()].toSorted());

      for (const [lang, parsed] of [["pl", pl], ["en", en]] as const) {
        for (const [base, suffixes] of parsed.plurals) {
          expect([...suffixes].toSorted(), `${lang}/${file}: ${base}`).toEqual(EXPECTED_PLURALS[lang]);
        }
      }
    });
  }
});
