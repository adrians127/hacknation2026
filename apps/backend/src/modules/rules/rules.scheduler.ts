import type { Logger } from "pino";

import { prisma } from "~backend/lib/prisma";
import { RULES_LOCK, RULES_TRANSACTION, applyRules } from "~backend/modules/rules/rules.apply";

/** A running scan sends results all the time: apply the rules at most this often. */
const MIN_INTERVAL_MS = 60_000;

const isNewer = (value: Date | null, seen: Date | null | undefined) =>
  value !== null && (seen === null || seen === undefined || value > seen);

/**
 * The scheduler's rule pass (`pipelines/scheduler.ts`): applies the rules again after new scan
 * results, new or re-evaluated vulnerability matches, or a rule expiring. Rule changes apply
 * themselves; `change_priority` rules are applied whenever changes are read.
 */
export async function rulesTick(log: Logger, now = new Date()): Promise<void> {
  const [state, [latest]] = await Promise.all([
    prisma.ruleState.findUnique({ where: { id: 1 } }),
    prisma.$queryRaw<{ resultsAt: Date | null; matchesAt: Date | null }[]>`
      SELECT (SELECT max("receivedAt") FROM "ScanJobResult") AS "resultsAt",
        (SELECT max("lastEvaluatedAt") FROM "VulnerabilityMatch") AS "matchesAt"`,
  ]);
  const resultsAt = latest?.resultsAt ?? null;
  const matchesAt = latest?.matchesAt ?? null;
  const appliedAt = state?.appliedAt ?? null;
  const expired = await prisma.rule.count({
    where: {
      kind: { not: "change_priority" },
      enabled: true,
      expiresAt: { lte: now, ...(appliedAt !== null && { gt: appliedAt }) },
    },
  });
  const isDue =
    isNewer(resultsAt, state?.resultsAt) || isNewer(matchesAt, state?.matchesAt) || expired > 0;
  if (!isDue) return;
  if (appliedAt !== null && now.getTime() - appliedAt.getTime() < MIN_INTERVAL_MS) return;

  const stats = await prisma.$transaction(async (db) => {
    const [lock] = await db.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(${RULES_LOCK}) AS locked`;
    // A rule change is applying the rules right now; the next tick looks again.
    if (!lock?.locked) return null;
    const applied = await applyRules(db, now);
    await db.ruleState.update({ where: { id: 1 }, data: { resultsAt, matchesAt } });
    return applied;
  }, RULES_TRANSACTION);
  if (stats && stats.hosts + stats.services + stats.vulnerabilities + stats.tags > 0) {
    log.info({ ...stats }, "Rules applied to new results");
  }
}
