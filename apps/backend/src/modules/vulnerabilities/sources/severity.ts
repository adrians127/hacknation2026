// A UMD bundle: Node's ESM loader sees no named exports, only the default (module.exports).
import cvss from "ae-cvss-calculator";

import type {
  VulnerabilitySeverity,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

export interface CvssScore {
  score: number;
  vector: string;
  version: string;
  severity: VulnerabilitySeverity;
}

/** Qualitative rating of a base score (CVSS v3/v4 table; v2 has no "critical"). */
export function severityOf(score: number, version: string): VulnerabilitySeverity {
  if (version.startsWith("2")) return score >= 7 ? "high" : score >= 4 ? "medium" : "low";
  if (score === 0) return "none";
  if (score < 4) return "low";
  if (score < 7) return "medium";
  if (score < 9) return "high";
  return "critical";
}

/** Base score of a vector string (OSV gives vectors only). `null` when it does not parse. */
export function scoreVector(vector: string): CvssScore | null {
  try {
    let version: string;
    let score: number | undefined;
    if (vector.startsWith("CVSS:4.0/")) {
      version = "4.0";
      score = new cvss.Cvss4P0(vector).calculateScores().base;
    } else if (vector.startsWith("CVSS:3.1/")) {
      version = "3.1";
      score = new cvss.Cvss3P1(vector).calculateScores().base;
    } else if (vector.startsWith("CVSS:3.0/")) {
      version = "3.0";
      score = new cvss.Cvss3P0(vector).calculateScores().base;
    } else {
      version = "2.0";
      score = new cvss.Cvss2(vector).calculateScores().base;
    }
    if (score === undefined || !Number.isFinite(score)) return null;
    return { score, vector, version, severity: severityOf(score, version) };
  } catch {
    return null;
  }
}

const LABELS: Record<string, VulnerabilitySeverity> = {
  CRITICAL: "critical",
  HIGH: "high",
  MODERATE: "medium",
  MEDIUM: "medium",
  LOW: "low",
  NONE: "none",
};

/** A source's own label (GHSA `MODERATE`, NVD `HIGH`). */
export function severityFromLabel(label: unknown): VulnerabilitySeverity | null {
  return typeof label === "string" ? (LABELS[label.toUpperCase()] ?? null) : null;
}
