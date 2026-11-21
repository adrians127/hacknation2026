import type { TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";

/** Tinted outline badges, in the style of the mock-data badge. */
export const TRIAGE_CLASS: Record<TriageStatus, string> = {
  unreviewed: "text-muted-foreground",
  reviewed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  important: "border-red-500/40 bg-red-500/10 text-red-500",
  false_positive: "text-muted-foreground line-through",
};

export function statusCodeClass(code: number | null): string {
  if (code === null) return "text-muted-foreground";
  if (code < 300) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
  if (code < 400) return "border-sky-500/40 bg-sky-500/10 text-sky-500";
  if (code < 500) return "border-amber-500/40 bg-amber-500/10 text-amber-500";
  return "border-red-500/40 bg-red-500/10 text-red-500";
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type CertificateState = "valid" | "expiring" | "expired";

/** `expiring`: less than 30 days left. */
export function certificateState(notAfter: string, now = Date.now()): CertificateState {
  const left = Date.parse(notAfter) - now;
  if (left < 0) return "expired";
  return left < 30 * DAY_MS ? "expiring" : "valid";
}
