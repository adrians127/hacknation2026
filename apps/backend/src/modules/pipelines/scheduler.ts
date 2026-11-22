import type { Logger } from "pino";

import { env } from "~backend/config/env";
import { pipelineRuns } from "~backend/modules/pipelines/pipeline-runs.service";
import { rulesTick } from "~backend/modules/rules/rules.scheduler";

/**
 * One scheduler pass. Every step is a conditional update, so API instances running it at the
 * same time do each thing once. Order matters: leases are reclaimed and closed windows paused
 * before a fire can resume a paused run.
 */
export async function tick(log: Logger, now = new Date()): Promise<void> {
  const reclaimed = await pipelineRuns.reclaimExpiredLeases(now);
  if (reclaimed > 0) log.info({ jobs: reclaimed }, "Re-queued jobs whose lease expired");
  const paused = await pipelineRuns.pauseClosedWindows(now);
  if (paused > 0) log.info({ scans: paused }, "Paused scans whose time window closed");
  await pipelineRuns.fireDuePipelines(now, log);
  await rulesTick(log, now);
}

/** Runs `tick` every `PIPELINE_SCHEDULER_TICK_SECONDS`, never two at once. Returns the stop function. */
export function startPipelineScheduler(log: Logger): () => void {
  let isRunning = false;
  const timer = setInterval(() => {
    if (isRunning) return;
    isRunning = true;
    tick(log)
      .catch((error: unknown) => log.error({ err: error }, "Pipeline scheduler tick failed"))
      .finally(() => {
        isRunning = false;
      });
  }, env.PIPELINE_SCHEDULER_TICK_SECONDS * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
