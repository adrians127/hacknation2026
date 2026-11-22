import type { SignatureSeverity } from "@subsurf/contracts/signatures/detection.schema";

/** Tinted outline badges, as the vulnerability severities. */
export const SIGNATURE_SEVERITY_CLASS: Record<SignatureSeverity, string> = {
  high: "border-orange-500/40 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  low: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  info: "text-muted-foreground",
};
