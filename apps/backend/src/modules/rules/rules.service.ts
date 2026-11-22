import {
  RuleDefinitionSchema,
  type CreateRuleBody,
  type Rule,
  type RuleAffected,
  type RuleListResponse,
  type RulePreviewBody,
  type RulePreviewResponse,
  type UpdateRuleBody,
} from "@subsurf/contracts/rules/rules.schema";

import { Prisma } from "~backend/generated/prisma/client";
import { decryptText, encryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { compileRules, rulesOfKind, type RuleRow } from "~backend/modules/rules/rule-match";
import { previewChanges, previewTargets } from "~backend/modules/rules/rule-preview";
import {
  RULES_LOCK,
  RULES_TRANSACTION,
  applyRules,
  loadRuleData,
} from "~backend/modules/rules/rules.apply";
import { scanResultsService } from "~backend/modules/scans/scan-results.service";

type Db = Prisma.TransactionClient;

const RULE_INCLUDE = { createdBy: { select: { id: true, displayName: true } } } as const;
type RuleRecord = Prisma.RuleGetPayload<{ include: typeof RULE_INCLUDE }>;

/** Stands in for a rule that is not saved yet in a preview; never stored. */
const PREVIEW_RULE_ID = "00000000-0000-7000-8000-000000000000";

const NOTHING: RuleAffected = { hosts: 0, services: 0, vulnerabilities: 0, tags: 0 };

async function affectedByRule(): Promise<Map<string, RuleAffected>> {
  const rows = await prisma.$queryRaw<{ ruleId: string; kind: keyof RuleAffected; count: number }[]>`
    SELECT "triageRuleId" AS "ruleId", 'hosts' AS kind, count(*)::int AS count
    FROM "Host" WHERE "triageRuleId" IS NOT NULL GROUP BY 1
    UNION ALL
    SELECT "triageRuleId", 'services', count(*)::int
    FROM "Service" WHERE "triageRuleId" IS NOT NULL GROUP BY 1
    UNION ALL
    SELECT "triageRuleId", 'vulnerabilities', count(*)::int
    FROM "ServiceVulnerabilityTriage" WHERE "triageRuleId" IS NOT NULL GROUP BY 1
    UNION ALL
    SELECT "ruleId", 'tags', count(*)::int FROM "RuleTag" GROUP BY 1`;
  const affected = new Map<string, RuleAffected>();
  for (const row of rows) {
    affected.set(row.ruleId, { ...(affected.get(row.ruleId) ?? NOTHING), [row.kind]: row.count });
  }
  return affected;
}

function toRule(row: RuleRecord, affected: RuleAffected, now: Date): Rule {
  return {
    id: row.id,
    name: row.name,
    note: decryptText(row.note),
    enabled: row.enabled,
    position: row.position,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    expired: row.expiresAt !== null && row.expiresAt <= now,
    definition: RuleDefinitionSchema.parse(row.definition),
    affected,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getRule(id: string): Promise<Rule> {
  const [row, affected] = await Promise.all([
    prisma.rule.findUnique({ where: { id }, include: RULE_INCLUDE }),
    affectedByRule(),
  ]);
  if (!row) throw HttpError.notFound("Rule not found");
  return toRule(row, affected.get(id) ?? NOTHING, new Date());
}

/** Rewrites `position` as 0..n-1 in the given order. */
async function renumber(db: Db, ids: readonly string[]): Promise<void> {
  for (const [position, id] of ids.entries()) {
    await db.rule.update({ where: { id }, data: { position } });
  }
}

async function orderedIds(db: Db): Promise<string[]> {
  const rows = await db.rule.findMany({
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** Rule changes and the pass that applies them commit together, one at a time. */
function inRulesTransaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(${RULES_LOCK})`;
    return work(db);
  }, RULES_TRANSACTION);
}

const noteValue = (note: string) => encryptText(note.trim()) ?? Prisma.DbNull;
const expiresValue = (expiresAt: string | null) => (expiresAt === null ? null : new Date(expiresAt));

export const rulesService = {
  async list(): Promise<RuleListResponse> {
    const [rows, affected] = await Promise.all([
      prisma.rule.findMany({
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        include: RULE_INCLUDE,
      }),
      affectedByRule(),
    ]);
    const now = new Date();
    return { items: rows.map((row) => toRule(row, affected.get(row.id) ?? NOTHING, now)) };
  },

  async create(createdById: string, body: CreateRuleBody): Promise<Rule> {
    const id = await inRulesTransaction(async (db) => {
      const row = await db.rule.create({
        data: {
          name: body.name.trim(),
          kind: body.definition.kind,
          enabled: body.enabled ?? true,
          position: await db.rule.count(),
          definition: body.definition,
          note: noteValue(body.note ?? ""),
          expiresAt: expiresValue(body.expiresAt ?? null),
          createdById,
        },
      });
      await applyRules(db);
      return row.id;
    });
    return getRule(id);
  },

  async update(id: string, body: UpdateRuleBody): Promise<Rule> {
    await inRulesTransaction(async (db) => {
      const { count } = await db.rule.updateMany({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.note !== undefined && { note: noteValue(body.note) }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
          ...(body.expiresAt !== undefined && { expiresAt: expiresValue(body.expiresAt) }),
          ...(body.definition !== undefined && {
            kind: body.definition.kind,
            definition: body.definition,
          }),
        },
      });
      if (count === 0) throw HttpError.notFound("Rule not found");
      if (body.position !== undefined) {
        const others = (await orderedIds(db)).filter((other) => other !== id);
        await renumber(db, others.toSpliced(Math.min(body.position, others.length), 0, id));
      }
      await applyRules(db);
    });
    return getRule(id);
  },

  /** What the rule set goes back (or to the next matching rule) before it is deleted. */
  async remove(id: string): Promise<void> {
    await inRulesTransaction(async (db) => {
      const { count } = await db.rule.updateMany({ where: { id }, data: { enabled: false } });
      if (count === 0) throw HttpError.notFound("Rule not found");
      await applyRules(db);
      await db.rule.delete({ where: { id } });
      await renumber(db, await orderedIds(db));
    });
  },

  async preview(body: RulePreviewBody): Promise<RulePreviewResponse> {
    const now = new Date();
    const rows = await prisma.rule.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
    if (body.ruleId !== undefined && !rows.some((row) => row.id === body.ruleId)) {
      throw HttpError.notFound("Rule not found");
    }
    const candidate: RuleRow = {
      id: body.ruleId ?? PREVIEW_RULE_ID,
      name: "",
      enabled: true,
      expiresAt: null,
      definition: body.definition,
    };
    const ordered = body.ruleId
      ? rows.map((row) => (row.id === body.ruleId ? candidate : row))
      : [...rows, candidate];
    const rules = compileRules(ordered, now);
    const self = rules.find((rule) => rule.ref.id === candidate.id);
    if (!self) throw new Error("The previewed rule did not compile");

    const latest = await prisma.scan.findFirst({
      where: { results: { some: {} } },
      orderBy: { createdAt: "desc" },
      select: { id: true, startedAt: true },
    });
    const scan = latest && { id: latest.id, startedAt: latest.startedAt?.toISOString() ?? null };

    if (self.definition.kind === "change_priority") {
      const changeRules = rulesOfKind(rules, "change_priority");
      const changeSelf = changeRules.find((rule) => rule.ref.id === self.ref.id);
      if (!latest || !changeSelf) {
        return { matched: 0, changes: 0, unchanged: 0, skipped: 0, samples: [], scan };
      }
      const { facts } = await scanResultsService.changeFacts(latest.id);
      return { ...previewChanges(changeSelf, changeRules, facts), scan };
    }
    const data = await loadRuleData(prisma, rules);
    return {
      ...previewTargets(self, rules, data),
      scan: self.definition.kind === "unchanged" ? scan : null,
    };
  },
};
