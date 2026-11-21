import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

import { JSONParser } from "@streamparser/json";
import { z } from "zod";

import {
  cpeMatchKey,
  joinedVersion,
  parseCpe23,
} from "~backend/modules/vulnerabilities/cpe/cpe";
import {
  CPE_KIND,
  type CpeCondition,
  type CpeCriterionData,
  type CpePlatform,
} from "~backend/modules/vulnerabilities/matchers/cpe.matcher";
import type { Criterion } from "~backend/modules/vulnerabilities/matchers/matcher";
import { canonicalIdOf } from "~backend/modules/vulnerabilities/sources/canonical";
import {
  severityFromLabel,
  severityOf,
} from "~backend/modules/vulnerabilities/sources/severity";
import type { NormalizedVulnerability } from "~backend/modules/vulnerabilities/sources/source";

const CpeMatchSchema = z.object({
  vulnerable: z.boolean(),
  criteria: z.string(),
  versionStartIncluding: z.string().optional(),
  versionStartExcluding: z.string().optional(),
  versionEndIncluding: z.string().optional(),
  versionEndExcluding: z.string().optional(),
});

const NodeSchema = z.object({
  operator: z.string().optional(),
  negate: z.boolean().optional(),
  cpeMatch: z.array(CpeMatchSchema).default([]),
});

const MetricSchema = z.object({
  type: z.string().optional(),
  baseSeverity: z.string().optional(),
  cvssData: z.object({
    version: z.string(),
    vectorString: z.string(),
    baseScore: z.number(),
    baseSeverity: z.string().optional(),
  }),
});

/** The parts of an NVD CVE API 2.0 record (`vulnerabilities[].cve`) the module uses. */
export const NvdCveSchema = z.object({
  id: z.string(),
  published: z.string().optional(),
  lastModified: z.string().optional(),
  vulnStatus: z.string().optional(),
  descriptions: z.array(z.object({ lang: z.string(), value: z.string() })).default([]),
  metrics: z.record(z.string(), z.array(MetricSchema)).default({}),
  configurations: z
    .array(
      z.object({
        operator: z.string().optional(),
        negate: z.boolean().optional(),
        nodes: z.array(NodeSchema),
      }),
    )
    .default([]),
  references: z.array(z.object({ url: z.string() })).default([]),
  cisaExploitAdd: z.string().optional(),
  cisaActionDue: z.string().optional(),
  cisaVulnerabilityName: z.string().optional(),
});

export type NvdCve = z.infer<typeof NvdCveSchema>;

const MAX_DESCRIPTION = 4000;
const MAX_REFERENCES = 20;
const MAX_PLATFORMS = 20;
const METRIC_VERSIONS = ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"];

/** NVD timestamps carry no zone and are UTC. */
export function nvdDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** NVD's own (Primary) score of the newest CVSS version, else the CNA's (Secondary). */
function primaryMetric(cve: NvdCve) {
  const all = METRIC_VERSIONS.flatMap((key) => cve.metrics[key] ?? []);
  return all.find((metric) => metric.type === "Primary") ?? all[0];
}

function condition(match: z.infer<typeof CpeMatchSchema>): CpeCondition | null {
  const cpe = parseCpe23(match.criteria);
  if (!cpe) return null;
  const range = {
    ...(match.versionStartIncluding && { startIncluding: match.versionStartIncluding }),
    ...(match.versionStartExcluding && { startExcluding: match.versionStartExcluding }),
    ...(match.versionEndIncluding && { endIncluding: match.versionEndIncluding }),
    ...(match.versionEndExcluding && { endExcluding: match.versionEndExcluding }),
  };
  if (Object.keys(range).length > 0) return range;
  const version = joinedVersion(cpe);
  return version === null ? { any: true } : { versions: [version] };
}

/** One criterion per product: exact versions with the same platform requirement collapse. */
function criteriaOf(cve: NvdCve): Criterion[] {
  const byKey = new Map<string, CpeCondition[]>();
  for (const configuration of cve.configurations) {
    const nodes = configuration.nodes;
    const negated = configuration.negate === true || nodes.some((node) => node.negate === true);
    const platforms: CpePlatform[] =
      configuration.operator === "AND"
        ? nodes
            .filter((node) => node.cpeMatch.every((match) => !match.vulnerable))
            .flatMap((node) => node.cpeMatch)
            .flatMap((match) => parseCpe23(match.criteria) ?? [])
            .slice(0, MAX_PLATFORMS)
            .map(({ part, vendor, product, version }) => ({
              part,
              vendor,
              product,
              version: version === "-" ? null : version,
            }))
        : [];

    for (const node of nodes) {
      for (const match of node.cpeMatch) {
        if (!match.vulnerable) continue;
        const cpe = parseCpe23(match.criteria);
        const base = condition(match);
        if (!cpe || !base || cpe.part === "h") continue;
        const key = cpeMatchKey(cpe);
        const full: CpeCondition = {
          ...base,
          ...(platforms.length > 0 && { platforms }),
          ...(negated && { negated: true as const }),
        };
        const conditions = byKey.get(key) ?? [];
        const sameKind = full.versions
          ? conditions.find(
              (existing) =>
                existing.versions &&
                JSON.stringify(existing.platforms) === JSON.stringify(full.platforms) &&
                existing.negated === full.negated,
            )
          : undefined;
        if (sameKind?.versions && full.versions) sameKind.versions.push(...full.versions);
        else conditions.push(full);
        byKey.set(key, conditions);
      }
    }
  }
  return [...byKey].map(([matchKey, conditions]) => ({
    kind: CPE_KIND,
    matchKey,
    data: {
      conditions: conditions.map((entry) =>
        entry.versions ? { ...entry, versions: [...new Set(entry.versions)] } : entry,
      ),
    } satisfies CpeCriterionData,
  }));
}

export function normalizeNvdCve(cve: NvdCve): NormalizedVulnerability {
  const rejected = cve.vulnStatus === "Rejected";
  const metric = rejected ? undefined : primaryMetric(cve);
  const score = metric?.cvssData.baseScore ?? null;
  const description =
    cve.descriptions.find((entry) => entry.lang === "en")?.value ?? cve.descriptions[0]?.value;
  const severity = metric
    ? (severityFromLabel(metric.cvssData.baseSeverity ?? metric.baseSeverity) ??
      severityOf(metric.cvssData.baseScore, metric.cvssData.version))
    : "unknown";
  return {
    externalId: cve.id,
    canonicalId: canonicalIdOf(cve.id),
    aliases: [],
    scopes: [],
    title: cve.cisaVulnerabilityName ?? null,
    description: description?.slice(0, MAX_DESCRIPTION) ?? null,
    status: rejected ? "rejected" : "active",
    withdrawnAt: rejected ? nvdDate(cve.lastModified) : null,
    severity,
    cvssScore: score,
    cvssVector: metric?.cvssData.vectorString ?? null,
    cvssVersion: metric?.cvssData.version ?? null,
    kevAddedAt: nvdDate(cve.cisaExploitAdd),
    kevDueDate: nvdDate(cve.cisaActionDue),
    references: [...new Set(cve.references.map((reference) => reference.url))].slice(
      0,
      MAX_REFERENCES,
    ),
    publishedAt: nvdDate(cve.published),
    sourceModifiedAt: nvdDate(cve.lastModified),
    criteria: rejected ? [] : criteriaOf(cve),
  };
}

const cveOf = (item: unknown): unknown =>
  typeof item === "object" && item !== null && "cve" in item ? item.cve : undefined;

/**
 * Streams the CVEs of an NVD JSON 2.0 feed file (`.json` or `.json.gz`) without loading it whole:
 * a year file is several hundred MB uncompressed. With `sha256` (from the feed's `.meta`), the
 * uncompressed bytes are checked once the file is read; a mismatch throws after the last record.
 */
export async function* readNvdFeed(
  path: string,
  signal: AbortSignal,
  sha256?: string,
): AsyncGenerator<NvdCve> {
  const file = createReadStream(path);
  const input = path.endsWith(".gz") ? file.pipe(createGunzip()) : file;
  const hash = createHash("sha256");
  const parser = new JSONParser({ paths: ["$.vulnerabilities.*"], keepStack: false });
  const pending: unknown[] = [];
  parser.onValue = ({ value }) => pending.push(value);

  try {
    for await (const chunk of input) {
      signal.throwIfAborted();
      const bytes: unknown = chunk;
      if (!Buffer.isBuffer(bytes)) throw new Error(`${path}: expected bytes`);
      hash.update(bytes);
      parser.write(bytes);
      for (const value of pending.splice(0)) {
        const parsed = NvdCveSchema.safeParse(cveOf(value));
        if (parsed.success) yield parsed.data;
      }
    }
  } finally {
    file.destroy();
  }
  if (sha256 && hash.digest("hex") !== sha256.toLowerCase()) {
    throw new Error(`${path}: checksum does not match the feed's .meta`);
  }
}
