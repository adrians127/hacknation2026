import { prisma } from "~backend/lib/prisma";
import {
  compileRules,
  rulesOfKind,
  type ChangePriorityRule,
} from "~backend/modules/rules/rule-match";

// Read by the scan views; kept apart from rules.service.ts, which reads the scan views itself.

/** Rule names by id, to show which rule set a triage. */
export async function ruleNames(): Promise<Map<string, string>> {
  const rows = await prisma.rule.findMany({ select: { id: true, name: true } });
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** The active `change_priority` rules in order, applied whenever changes are read. */
export async function loadChangeRules(now = new Date()): Promise<ChangePriorityRule[]> {
  const rows = await prisma.rule.findMany({
    where: { kind: "change_priority", enabled: true },
    orderBy: { position: "asc" },
  });
  return rulesOfKind(compileRules(rows, now), "change_priority");
}
