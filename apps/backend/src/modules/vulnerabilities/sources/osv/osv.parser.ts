import { z } from "zod";

import type { Criterion } from "~backend/modules/vulnerabilities/matchers/matcher";
import {
  PACKAGE_KIND,
  packageMatchKey,
  type PackageCriterionData,
  type PackageEntry,
  type PackageRange,
} from "~backend/modules/vulnerabilities/matchers/package.matcher";
import { canonicalIdOf } from "~backend/modules/vulnerabilities/sources/canonical";
import {
  scoreVector,
  severityFromLabel,
  type CvssScore,
} from "~backend/modules/vulnerabilities/sources/severity";
import type { NormalizedVulnerability } from "~backend/modules/vulnerabilities/sources/source";

const SeveritySchema = z.object({ type: z.string(), score: z.string() });

const EventSchema = z.object({
  introduced: z.string().optional(),
  fixed: z.string().optional(),
  last_affected: z.string().optional(),
  limit: z.string().optional(),
});

/** The parts of an OSV record (ossf.github.io/osv-schema) the module uses. */
export const OsvRecordSchema = z.object({
  id: z.string(),
  modified: z.string(),
  published: z.string().optional(),
  withdrawn: z.string().optional(),
  aliases: z.array(z.string()).nullish(),
  upstream: z.array(z.string()).nullish(),
  summary: z.string().optional(),
  details: z.string().optional(),
  severity: z.array(SeveritySchema).nullish(),
  affected: z
    .array(
      z.object({
        package: z.object({ ecosystem: z.string(), name: z.string() }).optional(),
        severity: z.array(SeveritySchema).nullish(),
        ranges: z
          .array(z.object({ type: z.string(), events: z.array(EventSchema).default([]) }))
          .nullish(),
        versions: z.array(z.string()).nullish(),
      }),
    )
    .nullish(),
  references: z.array(z.object({ url: z.string() })).nullish(),
  database_specific: z.record(z.string(), z.unknown()).nullish(),
});

export type OsvRecord = z.infer<typeof OsvRecordSchema>;

const MAX_DESCRIPTION = 4000;
const MAX_REFERENCES = 20;
const SEVERITY_PREFERENCE = ["CVSS_V3", "CVSS_V4", "CVSS_V2"];

function date(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `Debian:12` → Debian, 12; `Ubuntu:Pro:22.04:LTS` → Ubuntu, 22.04; `Maven` → Maven. */
export function splitEcosystem(raw: string): { ecosystem: string; release: string | null } {
  const [ecosystem, ...rest] = raw.split(":");
  const release = rest.filter((part) => part !== "LTS" && part !== "Pro").join(":");
  return { ecosystem, release: release === "" ? null : release };
}

function bestScore(record: OsvRecord): CvssScore | null {
  const vectors = [
    ...(record.severity ?? []),
    ...(record.affected ?? []).flatMap((entry) => entry.severity ?? []),
  ];
  for (const type of SEVERITY_PREFERENCE) {
    for (const severity of vectors.filter((entry) => entry.type === type)) {
      const score = scoreVector(severity.score);
      if (score) return score;
    }
  }
  return null;
}

function criteriaOf(record: OsvRecord): Criterion[] {
  const byKey = new Map<string, PackageEntry[]>();
  for (const affected of record.affected ?? []) {
    if (!affected.package) continue;
    const { ecosystem, release } = splitEcosystem(affected.package.ecosystem);
    const ranges = (affected.ranges ?? []).flatMap((range): PackageRange[] =>
      range.type === "SEMVER" || range.type === "ECOSYSTEM"
        ? [{ type: range.type, events: range.events }]
        : [],
    );
    const versions = affected.versions ?? [];
    if (ranges.length === 0 && versions.length === 0) continue;
    const key = packageMatchKey(ecosystem, affected.package.name);
    const entries = byKey.get(key) ?? [];
    entries.push({ ecosystem, release, versions, ranges });
    byKey.set(key, entries);
  }
  return [...byKey].map(([matchKey, entries]) => ({
    kind: PACKAGE_KIND,
    matchKey,
    data: { entries } satisfies PackageCriterionData,
  }));
}

export function normalizeOsvRecord(record: OsvRecord, scope: string): NormalizedVulnerability {
  const related = [...(record.aliases ?? []), ...(record.upstream ?? [])];
  const score = bestScore(record);
  const label = severityFromLabel(record.database_specific?.severity);
  const withdrawnAt = date(record.withdrawn);
  return {
    externalId: record.id,
    canonicalId: canonicalIdOf(record.id, related),
    aliases: [...new Set(related)],
    scopes: [scope],
    title: record.summary?.slice(0, 500) ?? null,
    description: record.details?.slice(0, MAX_DESCRIPTION) ?? null,
    status: withdrawnAt ? "withdrawn" : "active",
    withdrawnAt,
    severity: score?.severity ?? label ?? "unknown",
    cvssScore: score?.score ?? null,
    cvssVector: score?.vector ?? null,
    cvssVersion: score?.version ?? null,
    kevAddedAt: null,
    kevDueDate: null,
    references: [...new Set((record.references ?? []).map((reference) => reference.url))].slice(
      0,
      MAX_REFERENCES,
    ),
    publishedAt: date(record.published),
    sourceModifiedAt: date(record.modified),
    criteria: withdrawnAt ? [] : criteriaOf(record),
  };
}

/** `null` when the text is not an OSV record. */
export function parseOsvRecord(text: string): OsvRecord | null {
  try {
    const parsed = OsvRecordSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
