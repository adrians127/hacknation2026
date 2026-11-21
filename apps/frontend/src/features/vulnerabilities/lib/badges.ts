import type {
  VulnerabilitySeverity,
  VulnerabilityTriageStatus,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

/** Tinted outline badges, in the style of the hosts feature's badges. */
export const SEVERITY_CLASS: Record<VulnerabilitySeverity, string> = {
  critical: "border-red-600/50 bg-red-600/15 text-red-600 dark:text-red-400",
  high: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  low: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  none: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

export const VULNERABILITY_TRIAGE_CLASS: Record<VulnerabilityTriageStatus, string> = {
  unreviewed: "text-muted-foreground",
  important: "border-red-500/40 bg-red-500/10 text-red-500",
  accepted_risk: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  false_positive: "text-muted-foreground line-through",
};

export const KEV_CLASS = "border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400";
