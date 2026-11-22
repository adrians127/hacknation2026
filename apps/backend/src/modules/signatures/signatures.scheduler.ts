import type { Logger } from "pino";

import { loadActiveSet } from "~backend/modules/signatures/signature-catalog";
import { evaluateScan, staleScans } from "~backend/modules/signatures/signatures.evaluate";

/** A running scan sends results all the time: evaluate it at most this often. */
const RUNNING_INTERVAL_MS = 60_000;
/** One tick stops starting new scans after this; it always finishes at least one. */
const TICK_BUDGET_MS = 20_000;

const isActive = (status: string) => status === "running" || status === "queued" || status === "paused";

/**
 * The scheduler's signature pass (`pipelines/scheduler.ts`): evaluates the scans whose matches are
 * behind (new results, or the enabled signatures changed), newest first.
 */
export async function signaturesTick(log: Logger, now = new Date()): Promise<void> {
  const set = await loadActiveSet();
  const started = Date.now();
  let written = 0;
  let matches = 0;
  for (const scan of await staleScans(set.hash)) {
    const isSameSet = scan.setHash === set.hash;
    const isRecent =
      scan.evaluatedAt !== null && now.getTime() - scan.evaluatedAt.getTime() < RUNNING_INTERVAL_MS;
    if (isActive(scan.status) && isSameSet && isRecent) continue;
    if (written > 0 && Date.now() - started > TICK_BUDGET_MS) break;
    const evaluation = await evaluateScan(scan.id, set);
    // The signatures changed meanwhile: the next tick starts over with the new set.
    if (evaluation.outcome === "outdated") break;
    if (evaluation.outcome === "written") {
      written += 1;
      matches += evaluation.matches;
    }
  }
  if (written > 0) log.info({ scans: written, matches }, "Signatures evaluated on scans");
}
