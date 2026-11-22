import { z } from "zod";

import {
  MatchReasonSchema,
  SyncRunStatsSchema,
  VerdictSchema,
  type JobRequest,
  type PackageMapping,
  type ServiceVulnerability,
  type SyncRun,
  type VulnerabilitySeverity,
  type VulnerabilitySource,
  type VulnerabilitySummary,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import type { Prisma } from "~backend/generated/prisma/client";
import { decryptText } from "~backend/lib/crypto";
import type {
  VulnerabilitySource as SourceAdapter,
} from "~backend/modules/vulnerabilities/sources/source";
import { dueTimes } from "~backend/modules/vulnerabilities/sync/schedule";
import { EMPTY_STATS } from "~backend/modules/vulnerabilities/sync/sync.service";

type SourceRow = Prisma.VulnerabilitySourceGetPayload<object>;
type RunRow = Prisma.VulnerabilitySyncRunGetPayload<object>;
type RequestRow = Prisma.VulnerabilityJobRequestGetPayload<object>;
type MappingRow = Prisma.PackageMappingGetPayload<{
  include: { createdBy: { select: { id: true; displayName: true } } };
}>;

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function toRun(run: RunRow): SyncRun {
  const stats = SyncRunStatsSchema.partial().safeParse(run.stats);
  return {
    id: run.id,
    sourceId: run.sourceId,
    mode: run.mode,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: iso(run.finishedAt),
    stats: { ...EMPTY_STATS, ...(stats.success ? stats.data : {}) },
    error: run.error,
  };
}

export function toJobRequest(request: RequestRow): JobRequest {
  return {
    id: request.id,
    kind: request.kind,
    sourceId: request.sourceId,
    createdAt: request.createdAt.toISOString(),
  };
}

export function toSource(
  adapter: SourceAdapter,
  row: SourceRow,
  running: RunRow | undefined,
  pending: RequestRow | undefined,
  processActive: boolean,
): VulnerabilitySource {
  const due = row.enabled && processActive ? dueTimes(row) : null;
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    enabled: row.enabled,
    baseUrl: adapter.baseUrl,
    scopes: [...adapter.scopes],
    recordCount: row.recordCount,
    lastIncrementalAt: iso(row.lastIncrementalAt),
    lastFullAt: iso(row.lastFullAt),
    lastSuccessAt: iso(row.lastSuccessAt),
    lastError: row.lastError,
    nextIncrementalAt: due ? due.nextIncrementalAt.toISOString() : null,
    nextFullAt: due ? due.nextFullAt.toISOString() : null,
    running: running ? toRun(running) : null,
    pendingRequest: pending ? toJobRequest(pending) : null,
  };
}

export function toMapping(row: MappingRow): PackageMapping {
  return {
    id: row.id,
    cpeVendor: row.cpeVendor,
    cpeProduct: row.cpeProduct,
    ecosystem: row.ecosystem,
    packageName: row.packageName,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

const EvidenceSchema = z.array(
  z.object({ sourceId: z.string(), externalId: z.string(), verdict: VerdictSchema }),
);

const BasisSchema = z.object({
  scanId: z.string().nullable().catch(null),
  cpe: z.string().nullable().catch(null),
  version: z.string().nullable().catch(null),
});

export type MatchRow = Prisma.VulnerabilityMatchGetPayload<object>;
export type VulnerabilityRow = Prisma.VulnerabilityGetPayload<object>;
export type TriageRow = Prisma.ServiceVulnerabilityTriageGetPayload<object>;

/** One match with what the UI shows of it: the displayed record and the user's triage. */
export function toServiceVulnerability(
  match: MatchRow,
  record: VulnerabilityRow | undefined,
  triage: TriageRow | undefined,
  detailUrl: (sourceId: string, externalId: string) => string | null,
): ServiceVulnerability {
  const evidence = EvidenceSchema.safeParse(match.evidence);
  const basis = BasisSchema.safeParse(match.basis);
  return {
    canonicalId: match.canonicalId,
    title: match.title,
    description: record?.description ?? null,
    severity: match.severity,
    cvssScore: match.cvssScore,
    cvssVector: record?.cvssVector ?? null,
    kevAddedAt: iso(record?.kevAddedAt ?? null),
    publishedAt: iso(record?.publishedAt ?? null),
    confidence: match.confidence,
    reasons: match.reasons.flatMap((reason) => {
      const parsed = MatchReasonSchema.safeParse(reason);
      return parsed.success ? [parsed.data] : [];
    }),
    status: match.status,
    retractReason: match.retractReason,
    retractedAt: iso(match.retractedAt),
    firstMatchedAt: match.firstMatchedAt.toISOString(),
    lastEvaluatedAt: match.lastEvaluatedAt.toISOString(),
    basis: basis.success ? basis.data : { scanId: null, cpe: null, version: null },
    evidence: (evidence.success ? evidence.data : []).flatMap((entry) => {
      const url = detailUrl(entry.sourceId, entry.externalId);
      return url ? [{ ...entry, url }] : [];
    }),
    references: (record?.references ?? []).filter((url) => URL.canParse(url)).slice(0, 10),
    triage: triage?.triage ?? "unreviewed",
    note: triage ? decryptText(triage.note) : "",
  };
}

const SEVERITY_RANK: Record<VulnerabilitySeverity, number> = {
  unknown: 0,
  none: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

export const EMPTY_SUMMARY: VulnerabilitySummary = {
  confirmed: 0,
  potential: 0,
  kev: 0,
  maxSeverity: null,
};

/** Counts per canonical id: the same CVE on two services of a host counts once for the host. */
export function summarize(
  matches: readonly Pick<MatchRow, "canonicalId" | "confidence" | "severity" | "kev">[],
): VulnerabilitySummary {
  const confirmed = new Map<string, (typeof matches)[number]>();
  const potential = new Set<string>();
  for (const match of matches) {
    if (match.confidence === "confirmed") confirmed.set(match.canonicalId, match);
    else potential.add(match.canonicalId);
  }
  for (const id of confirmed.keys()) potential.delete(id);
  let maxSeverity: VulnerabilitySeverity | null = null;
  for (const { severity } of confirmed.values()) {
    if (maxSeverity === null || SEVERITY_RANK[severity] > SEVERITY_RANK[maxSeverity]) {
      maxSeverity = severity;
    }
  }
  return {
    confirmed: confirmed.size,
    potential: potential.size,
    kev: [...confirmed.values()].filter((match) => match.kev).length,
    maxSeverity,
  };
}
