import type {
  MatchConfidence,
  MatchReason,
  Verdict,
  VulnerabilitySeverity,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import type { Component } from "~backend/modules/vulnerabilities/components/component";
import type { DistroHint } from "~backend/modules/vulnerabilities/components/distro-hint";
import { CPE_KIND } from "~backend/modules/vulnerabilities/matchers/cpe.matcher";
import type { Evaluation } from "~backend/modules/vulnerabilities/matchers/matcher";

export interface RecordInfo {
  vulnerabilityId: string;
  sourceId: string;
  externalId: string;
  canonicalId: string;
  title: string | null;
  severity: VulnerabilitySeverity;
  cvssScore: number | null;
  kev: boolean;
}

/** One criterion of one record, evaluated against one component of the service. */
export interface RecordEvaluation {
  record: RecordInfo;
  kind: string;
  component: Component;
  evaluation: Evaluation;
}

export interface EvidenceEntry {
  sourceId: string;
  externalId: string;
  vulnerabilityId: string;
  verdict: Verdict;
}

export interface ResolvedMatch {
  canonicalId: string;
  confidence: MatchConfidence;
  reasons: MatchReason[];
  evidence: EvidenceEntry[];
  /** The record shown for the vulnerability (title, severity). */
  best: RecordInfo;
  kev: boolean;
  /** The component the strongest affected verdict came from. */
  component: Component;
}

interface RecordVerdict {
  record: RecordInfo;
  evaluation: Evaluation;
  /** Every affected verdict came from upstream CPE data (NVD), none from a package source. */
  upstreamOnly: boolean;
  component: Component;
}

const VERDICT_RANK: Record<Verdict, number> = { unknown: 0, not_affected: 1, affected: 2 };
const SEVERITY_RANK: Record<VulnerabilitySeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: 1,
  unknown: 0,
};

function strength(evaluation: Evaluation): number {
  return (
    VERDICT_RANK[evaluation.verdict] * 4 +
    (evaluation.verdict === "affected" && evaluation.confidence === "confirmed" ? 2 : 0) +
    (evaluation.distroPrecise ? 1 : 0)
  );
}

/** A record checked through several criteria or components counts once: its strongest verdict. */
function verdictPerRecord(evaluations: readonly RecordEvaluation[]): RecordVerdict[] {
  const byRecord = new Map<string, RecordVerdict>();
  for (const item of evaluations) {
    const current = byRecord.get(item.record.vulnerabilityId);
    const isUpstream = item.kind === CPE_KIND;
    if (!current || strength(item.evaluation) > strength(current.evaluation)) {
      byRecord.set(item.record.vulnerabilityId, {
        record: item.record,
        evaluation: item.evaluation,
        upstreamOnly: isUpstream,
        component: item.component,
      });
    } else if (item.evaluation.verdict === "affected" && !isUpstream) {
      current.upstreamOnly = false;
    }
  }
  return [...byRecord.values()];
}

function bestRecord(records: readonly RecordInfo[], sourceOrder: readonly string[]): RecordInfo {
  const priority = (record: RecordInfo) => {
    const index = sourceOrder.indexOf(record.sourceId);
    return index === -1 ? sourceOrder.length : index;
  };
  return records.toSorted(
    (a, b) =>
      Number(b.severity !== "unknown") - Number(a.severity !== "unknown") ||
      priority(a) - priority(b) ||
      (b.cvssScore ?? -1) - (a.cvssScore ?? -1) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
  )[0];
}

/**
 * Merges every source's verdicts on one service into one match per vulnerability (canonical id):
 * - no source says "affected" → no match;
 * - the distribution's own data on the exact package revision decides when it has any: affected
 *   → confirmed, not affected → the upstream hits become `potential` (`fixed_by_backport`);
 * - otherwise an upstream-only (NVD) hit on a distribution package is `potential`
 *   (`distro_backport_possible`): the distribution may have patched it without a version bump.
 */
export function resolveMatches(
  evaluations: readonly RecordEvaluation[],
  distro: DistroHint,
  sourceOrder: readonly string[],
): ResolvedMatch[] {
  const byCanonical = new Map<string, RecordEvaluation[]>();
  for (const item of evaluations) {
    const list = byCanonical.get(item.record.canonicalId) ?? [];
    list.push(item);
    byCanonical.set(item.record.canonicalId, list);
  }

  const matches: ResolvedMatch[] = [];
  for (const [canonicalId, items] of byCanonical) {
    const verdicts = verdictPerRecord(items);
    const hits = verdicts.filter((verdict) => verdict.evaluation.verdict === "affected");
    if (hits.length === 0) continue;

    const strongest = hits.toSorted((a, b) => strength(b.evaluation) - strength(a.evaluation))[0];
    const precise = verdicts.filter((verdict) => verdict.evaluation.distroPrecise);
    let confidence: MatchConfidence;
    const reasons = new Set<MatchReason>();

    if (precise.some((verdict) => verdict.evaluation.verdict === "affected")) {
      confidence = "confirmed";
    } else if (precise.some((verdict) => verdict.evaluation.verdict === "not_affected")) {
      confidence = "potential";
      reasons.add("fixed_by_backport");
    } else {
      const confirmed = hits.filter((verdict) => verdict.evaluation.confidence === "confirmed");
      confidence = confirmed.length > 0 ? "confirmed" : "potential";
      if (confidence === "confirmed" && distro.family && confirmed.every((v) => v.upstreamOnly)) {
        confidence = "potential";
        reasons.add("distro_backport_possible");
      }
      if (confidence === "potential") {
        for (const verdict of hits) {
          for (const reason of verdict.evaluation.reasons) reasons.add(reason);
        }
      }
    }

    matches.push({
      canonicalId,
      confidence,
      reasons: [...reasons].toSorted(),
      evidence: verdicts
        .filter((verdict) => verdict.evaluation.verdict !== "unknown")
        .map((verdict) => ({
          sourceId: verdict.record.sourceId,
          externalId: verdict.record.externalId,
          vulnerabilityId: verdict.record.vulnerabilityId,
          verdict: verdict.evaluation.verdict,
        }))
        .toSorted(
          (a, b) =>
            a.sourceId.localeCompare(b.sourceId) || a.externalId.localeCompare(b.externalId),
        ),
      best: bestRecord(
        hits.map((hit) => hit.record),
        sourceOrder,
      ),
      kev: verdicts.some((verdict) => verdict.record.kev),
      component: strongest.component,
    });
  }
  return matches.toSorted((a, b) => a.canonicalId.localeCompare(b.canonicalId));
}
