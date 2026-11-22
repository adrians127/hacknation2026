import type { SyncMode } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { env } from "~backend/config/env";

const HOUR_MS = 60 * 60 * 1000;

export interface Schedule {
  incrementalEveryMs: number;
  fullEveryMs: number;
}

export const DEFAULT_SCHEDULE: Schedule = {
  incrementalEveryMs: env.VULN_SYNC_INTERVAL_HOURS * HOUR_MS,
  fullEveryMs: env.VULN_FULL_SYNC_INTERVAL_DAYS * 24 * HOUR_MS,
};

interface SourceTimes {
  lastIncrementalAt: Date | null;
  lastFullAt: Date | null;
}

/** When each mode is next due: a source with no full sync yet is due now. */
export function dueTimes(source: SourceTimes, schedule: Schedule = DEFAULT_SCHEDULE) {
  const nextFullAt = source.lastFullAt
    ? new Date(source.lastFullAt.getTime() + schedule.fullEveryMs)
    : new Date(0);
  const nextIncrementalAt = source.lastIncrementalAt
    ? new Date(source.lastIncrementalAt.getTime() + schedule.incrementalEveryMs)
    : nextFullAt;
  return { nextFullAt, nextIncrementalAt };
}

export function dueMode(
  source: SourceTimes,
  now: Date,
  schedule = DEFAULT_SCHEDULE,
): SyncMode | null {
  const { nextFullAt, nextIncrementalAt } = dueTimes(source, schedule);
  if (nextFullAt <= now) return "full";
  if (nextIncrementalAt <= now) return "incremental";
  return null;
}
