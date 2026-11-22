import { chunks } from "~backend/lib/chunks";
import type { Prisma } from "~backend/generated/prisma/client";
import {
  loadHostTargets,
  loadVulnerabilityTargets,
} from "~backend/modules/rules/rule-context";
import { compileRules, rulesOfKind, type CompiledRule } from "~backend/modules/rules/rule-match";
import {
  NO_HISTORY,
  planRules,
  type ChangeHistory,
  type RuleData,
  type RulePlan,
  type TriageWrite,
} from "~backend/modules/rules/rule-plan";
import { scanResultsService } from "~backend/modules/scans/scan-results.service";

type Db = Prisma.TransactionClient;

// Arbitrary, fixed: one rule pass at a time, so two passes never write the same values at once.
export const RULES_LOCK = 7_366_737_202;
export const RULES_TRANSACTION = { timeout: 5 * 60_000, maxWait: 30_000 };
const WRITE_CHUNK = 5000;

export interface RuleApplyStats {
  hosts: number;
  services: number;
  vulnerabilities: number;
  tags: number;
}

/** Every rule in order, the disabled and expired ones left out. */
export async function loadRules(db: Db, now: Date): Promise<CompiledRule[]> {
  const rows = await db.rule.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return compileRules(rows, now);
}

/** The latest scans' changes, as far back as the `unchanged` rules look. */
export async function changeHistory(rules: readonly CompiledRule[]): Promise<ChangeHistory> {
  const scans = Math.max(
    0,
    ...rulesOfKind(rules, "unchanged").map((rule) => rule.definition.condition.scans),
  );
  if (scans === 0) return NO_HISTORY;
  const diffs = await scanResultsService.recentDiffs(scans);
  return {
    hosts: diffs.map((entries) => new Map(entries.map((entry) => [entry.hostId, entry.change]))),
    services: diffs.map(
      (entries) =>
        new Map(
          entries.flatMap((entry) =>
            entry.services.map((service) => [service.serviceId, service.change] as const),
          ),
        ),
    ),
  };
}

export async function loadRuleData(db: Db, rules: readonly CompiledRule[]): Promise<RuleData> {
  const hasVulnerabilityRules = rulesOfKind(rules, "vulnerability").length > 0;
  const [hosts, vulnerabilities, ruleTags, history] = await Promise.all([
    loadHostTargets(db),
    // Without such rules nothing is matched, and what earlier rules set is reverted by writePlan.
    hasVulnerabilityRules ? loadVulnerabilityTargets(db) : [],
    db.ruleTag.findMany({
      select: { id: true, ruleId: true, targetKind: true, targetId: true, tag: true },
    }),
    changeHistory(rules),
  ]);
  return { hosts, vulnerabilities, ruleTags, history };
}

const triageRows = (writes: readonly TriageWrite[]) =>
  writes.map((write) => ({
    id: write.id,
    value: write.to.value,
    ruleId: write.to.ruleId,
    fromValue: write.from.value,
    fromRuleId: write.from.ruleId,
  }));

// Conditional on the value read: a user's edit made meanwhile wins, the next pass sees it.
async function writeHostTriage(db: Db, writes: readonly TriageWrite[]): Promise<number> {
  let written = 0;
  for (const batch of chunks(writes, WRITE_CHUNK)) {
    written += await db.$executeRaw`
      UPDATE "Host" AS h
      SET triage = r.value::"TriageStatus", "triageRuleId" = r."ruleId", "updatedAt" = now()
      FROM jsonb_to_recordset(${JSON.stringify(triageRows(batch))}::jsonb) AS r(
        id uuid, value text, "ruleId" uuid, "fromValue" text, "fromRuleId" uuid
      )
      WHERE h.id = r.id AND h.triage::text = r."fromValue"
        AND h."triageRuleId" IS NOT DISTINCT FROM r."fromRuleId"`;
  }
  return written;
}

async function writeServiceTriage(db: Db, writes: readonly TriageWrite[]): Promise<number> {
  let written = 0;
  for (const batch of chunks(writes, WRITE_CHUNK)) {
    written += await db.$executeRaw`
      UPDATE "Service" AS s
      SET triage = r.value::"TriageStatus", "triageRuleId" = r."ruleId", "updatedAt" = now()
      FROM jsonb_to_recordset(${JSON.stringify(triageRows(batch))}::jsonb) AS r(
        id uuid, value text, "ruleId" uuid, "fromValue" text, "fromRuleId" uuid
      )
      WHERE s.id = r.id AND s.triage::text = r."fromValue"
        AND s."triageRuleId" IS NOT DISTINCT FROM r."fromRuleId"`;
  }
  return written;
}

async function writeVulnerabilityTriage(
  db: Db,
  plan: RulePlan,
  activeRuleIds: readonly string[],
): Promise<number> {
  let written = 0;
  const rows = plan.vulnerabilityTriage.map((write) => ({
    serviceId: write.serviceId,
    canonicalId: write.vulnerabilityId,
    hasRow: write.hasRow,
    value: write.to.value,
    ruleId: write.to.ruleId,
    fromValue: write.from.value,
    fromRuleId: write.from.ruleId,
  }));
  for (const batch of chunks(rows.filter((row) => row.hasRow), WRITE_CHUNK)) {
    written += await db.$executeRaw`
      UPDATE "ServiceVulnerabilityTriage" AS t
      SET triage = r.value::"VulnerabilityTriageStatus", "triageRuleId" = r."ruleId",
          "updatedAt" = now()
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(
        "serviceId" uuid, "canonicalId" text, value text, "ruleId" uuid, "fromValue" text,
        "fromRuleId" uuid
      )
      WHERE t."serviceId" = r."serviceId" AND t."canonicalId" = r."canonicalId"
        AND t.triage::text = r."fromValue" AND t."triageRuleId" IS NOT DISTINCT FROM r."fromRuleId"`;
  }
  // A row a user created meanwhile is theirs: DO NOTHING.
  for (const batch of chunks(rows.filter((row) => !row.hasRow), WRITE_CHUNK)) {
    written += await db.$executeRaw`
      INSERT INTO "ServiceVulnerabilityTriage" (
        id, "serviceId", "canonicalId", triage, "triageRuleId", "createdAt", "updatedAt"
      )
      SELECT uuidv7(), r."serviceId", r."canonicalId", r.value::"VulnerabilityTriageStatus",
        r."ruleId", now(), now()
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS r(
        "serviceId" uuid, "canonicalId" text, value text, "ruleId" uuid
      )
      ON CONFLICT ("serviceId", "canonicalId") DO NOTHING`;
  }
  // Verdicts of rules that are gone, disabled or expired on matches that are no longer active.
  written += await db.$executeRaw`
    UPDATE "ServiceVulnerabilityTriage"
    SET triage = 'unreviewed', "triageRuleId" = NULL, "updatedAt" = now()
    WHERE "triageRuleId" IS NOT NULL AND NOT ("triageRuleId" = ANY(${[...activeRuleIds]}::uuid[]))`;
  return written;
}

async function writeTags(db: Db, plan: RulePlan): Promise<number> {
  let written = 0;
  for (const kind of ["host", "service"] as const) {
    const writes = plan.tags.filter((write) => write.kind === kind);
    for (const batch of chunks(writes, WRITE_CHUNK)) {
      const rows = JSON.stringify(
        batch.map((write) => ({ id: write.id, before: write.before, after: write.after })),
      );
      const updated =
        kind === "host"
          ? await db.$queryRaw<{ id: string }[]>`
              UPDATE "Host" AS h SET tags = r.after, "updatedAt" = now()
              FROM jsonb_to_recordset(${rows}::jsonb) AS r(id uuid, before text[], after text[])
              WHERE h.id = r.id AND h.tags = r.before
              RETURNING h.id`
          : await db.$queryRaw<{ id: string }[]>`
              UPDATE "Service" AS s SET tags = r.after, "updatedAt" = now()
              FROM jsonb_to_recordset(${rows}::jsonb) AS r(id uuid, before text[], after text[])
              WHERE s.id = r.id AND s.tags = r.before
              RETURNING s.id`;
      const done = new Set(updated.map((row) => row.id));
      const applied = batch.filter((write) => done.has(write.id));
      written += applied.length;
      await db.ruleTag.createMany({
        data: applied.flatMap((write) =>
          write.add.map((add) => ({ ...add, targetKind: kind, targetId: write.id })),
        ),
        skipDuplicates: true,
      });
      const drop = applied.flatMap((write) => write.drop);
      if (drop.length > 0) await db.ruleTag.deleteMany({ where: { id: { in: drop } } });
    }
  }
  for (const batch of chunks(plan.dropRuleTags, WRITE_CHUNK)) {
    await db.ruleTag.deleteMany({ where: { id: { in: batch } } });
  }
  return written;
}

/**
 * Brings every value rules may own in line with the rules as they are now: what a matching rule
 * says, back to `unreviewed` where none matches any more, never what a user set. Takes the rules
 * lock for the rest of the transaction.
 */
export async function applyRules(db: Db, now = new Date()): Promise<RuleApplyStats> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${RULES_LOCK})`;
  const rules = await loadRules(db, now);
  const plan = planRules(rules, await loadRuleData(db, rules));
  const vulnerabilityRuleIds = rulesOfKind(rules, "vulnerability").map((rule) => rule.ref.id);
  const stats = {
    hosts: await writeHostTriage(db, plan.hostTriage),
    services: await writeServiceTriage(db, plan.serviceTriage),
    vulnerabilities: await writeVulnerabilityTriage(db, plan, vulnerabilityRuleIds),
    tags: await writeTags(db, plan),
  };
  await db.ruleState.upsert({
    where: { id: 1 },
    create: { id: 1, appliedAt: now },
    update: { appliedAt: now },
  });
  return stats;
}
