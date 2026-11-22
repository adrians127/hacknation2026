import type { Prisma } from "~backend/generated/prisma/client";
import type { AuthContext } from "~backend/lib/auth-context";
import { queueRun, type QueueRunResult, type ScanTargetRow } from "~backend/modules/pipelines/queue-run";
import { defaultSteps } from "~backend/modules/pipelines/steps";
import type { DnsResolution } from "~backend/modules/scans/dns";

export type { ScanTargetRow };
export type QueueScanResult = QueueRunResult;

export const scansService = {
  /**
   * Queues a scan of inventory targets with the default steps (masscan with the env defaults,
   * then nmap on its hits), as far as managers have registered those workers. Domains must be
   * resolved beforehand (`resolveDomains`), outside `tx`.
   */
  async queue(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    targets: readonly ScanTargetRow[],
    dns: DnsResolution,
  ): Promise<QueueScanResult> {
    const { steps, missing } = await defaultSteps(tx);
    const unregistered = missing.map((name) => ({ code: "worker_not_registered" as const, value: name }));
    if (steps.length === 0) return { scan: null, warnings: [...dns.warnings, ...unregistered] };
    const queued = await queueRun(tx, {
      requestedById: auth.user.id,
      pipelineId: null,
      trigger: "import",
      steps,
      stepTargets: new Map(
        steps.filter((step) => step.input === "targets").map((step) => [step.index, { targets }]),
      ),
      dns,
      windowEndsAt: null,
    });
    return { ...queued, warnings: [...queued.warnings, ...unregistered] };
  },
};
