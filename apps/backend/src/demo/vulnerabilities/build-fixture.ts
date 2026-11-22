// Rebuilds nvd.json and osv.json, the demo slice of the vulnerability databases, from a database
// that holds the demo scans and a full sync of every source (the downloads still in the cache):
//   pnpm db:seed:hosts && pnpm vulns:sync --once --full
//   pnpm --filter @subsurf/backend exec tsx src/demo/vulnerabilities/build-fixture.ts
import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { env } from "~backend/config/env";
import { prisma } from "~backend/lib/prisma";
import {
  readNvdFeed,
  type NvdCve,
} from "~backend/modules/vulnerabilities/sources/nvd/nvd.parser";
import { OsvRecordSchema } from "~backend/modules/vulnerabilities/sources/osv/osv.parser";
import { readZipJson } from "~backend/modules/vulnerabilities/sources/osv/osv.zip";

/** Per product version: this many matches, the most severe (KEV first)… */
const PER_VERSION = 8;
/** …plus this many that a distribution's backport overrules, to show that case too. */
const BACKPORTS_PER_VERSION = 4;
const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 1,
  unknown: 0,
};

const EvidenceSchema = z.array(
  z.object({ sourceId: z.string(), externalId: z.string(), verdict: z.string() }),
);
const BasisSchema = z.object({ cpe: z.string().nullable().catch(null) });

const here = fileURLToPath(new URL(".", import.meta.url));
const cache = resolve(env.VULN_CACHE_DIR);
const signal = new AbortController().signal;

async function wantedRecords(): Promise<Map<string, Set<string>>> {
  const matches = await prisma.vulnerabilityMatch.findMany({
    select: {
      reasons: true,
      basis: true,
      evidence: true,
      kev: true,
      severity: true,
      cvssScore: true,
      confidence: true,
    },
  });
  const byVersion = Map.groupBy(matches, (match) => BasisSchema.parse(match.basis).cpe ?? "");
  const wanted = new Map<string, Set<string>>([
    ["nvd", new Set()],
    ["osv", new Set()],
  ]);
  for (const group of byVersion.values()) {
    const chosen = group
      .toSorted(
        (a, b) =>
          Number(b.kev) - Number(a.kev) ||
          Number(b.confidence === "confirmed") - Number(a.confidence === "confirmed") ||
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          (b.cvssScore ?? 0) - (a.cvssScore ?? 0),
      )
      .slice(0, PER_VERSION);
    const backports = group
      .filter((match) => match.reasons.includes("fixed_by_backport"))
      .slice(0, BACKPORTS_PER_VERSION);
    for (const match of [...chosen, ...backports]) {
      for (const entry of EvidenceSchema.parse(match.evidence)) {
        wanted.get(entry.sourceId)?.add(entry.externalId);
      }
    }
  }
  return wanted;
}

async function nvdSlice(ids: ReadonlySet<string>): Promise<NvdCve[]> {
  const found = new Map<string, NvdCve>();
  const files = (await readdir(join(cache, "nvd"))).filter((name) => name.endsWith(".json.gz"));
  for (const file of files.toSorted()) {
    for await (const cve of readNvdFeed(join(cache, "nvd", file), signal)) {
      const known = found.get(cve.id);
      if (ids.has(cve.id) && (!known || (cve.lastModified ?? "") > (known.lastModified ?? ""))) {
        found.set(cve.id, {
          ...cve,
          descriptions: cve.descriptions.filter((entry) => entry.lang === "en"),
          references: cve.references.slice(0, 5),
        });
      }
    }
  }
  return [...found.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}

async function osvSlice(ids: ReadonlySet<string>) {
  // A GHSA can be in several ecosystems' zips: keep one copy.
  const records = new Map<string, z.infer<typeof OsvRecordSchema>>();
  for (const ecosystem of await readdir(join(cache, "osv"))) {
    const zip = join(cache, "osv", ecosystem, "all.zip");
    const keep = (name: string) => ids.has(name.replace(/\.json$/, ""));
    for await (const text of readZipJson(zip, keep, signal)) {
      const record = OsvRecordSchema.parse(JSON.parse(text));
      records.set(record.id, { ...record, references: (record.references ?? []).slice(0, 5) });
    }
  }
  return [...records.values()].toSorted((a, b) => a.id.localeCompare(b.id));
}

async function main(): Promise<void> {
  const wanted = await wantedRecords();
  const nvd = await nvdSlice(wanted.get("nvd") ?? new Set());
  const osv = await osvSlice(wanted.get("osv") ?? new Set());
  const feed = { format: "NVD_CVE", version: "2.0", vulnerabilities: nvd.map((cve) => ({ cve })) };
  await writeFile(join(here, "nvd.json"), `${JSON.stringify(feed, null, 1)}\n`);
  await writeFile(join(here, "osv.json"), `${JSON.stringify(osv, null, 1)}\n`);
  console.log(`Demo slice: ${nvd.length} NVD records, ${osv.length} OSV records`);
}

main()
  .catch((error: unknown) => {
    console.error("Building the demo slice failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
