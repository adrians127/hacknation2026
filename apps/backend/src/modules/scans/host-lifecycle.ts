import {
  INACTIVE_AFTER_MISSES,
  LIFECYCLE_WINDOW,
  UNSTABLE_MIN_FLIPS,
  type HostLifecycle,
} from "@subsurf/contracts/scans/scan-results.schema";

import type { HostObservationStatus } from "~backend/generated/prisma/client";

/** One address's answers in successive scans, newest first (`HostLifecycleStateSchema`). */
export function hostLifecycle(statuses: readonly HostObservationStatus[]): HostLifecycle {
  const answers = statuses
    .filter((status) => status === "up" || status === "down")
    .slice(0, LIFECYCLE_WINDOW);
  const firstUp = answers.indexOf("up");
  const misses = firstUp === -1 ? answers.length : firstUp;
  const flips = answers.filter((status, index) => index > 0 && status !== answers[index - 1]).length;
  const state =
    misses >= INACTIVE_AFTER_MISSES
      ? "inactive"
      : flips >= UNSTABLE_MIN_FLIPS
        ? "unstable"
        : misses > 0
          ? "missing"
          : "active";
  return { state, misses, flips };
}
