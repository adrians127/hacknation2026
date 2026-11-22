import type { RuleDefinition, RuleScope } from "@subsurf/contracts/rules/rules.schema";

import { prisma } from "~backend/lib/prisma";

export const ANYWHERE: RuleScope = { ranges: [], hostTags: [], ports: [], products: [] };

type Kind = RuleDefinition["kind"];
type DefinitionOf<K extends Kind> = Extract<RuleDefinition, { kind: K }>;

const DEFAULTS: { [K in Kind]: DefinitionOf<K> } = {
  vulnerability: {
    kind: "vulnerability",
    scope: ANYWHERE,
    condition: {
      vulnerabilityIds: [],
      severities: [],
      cvssAtLeast: null,
      cvssBelow: null,
      kev: null,
      confidence: null,
      reasons: [],
    },
    action: { triage: "false_positive" },
  },
  service: {
    kind: "service",
    scope: ANYWHERE,
    condition: { target: "service", titles: [] },
    action: { triage: "important", tag: null },
  },
  unchanged: {
    kind: "unchanged",
    scope: ANYWHERE,
    condition: { target: "service", scans: 1 },
    action: { triage: "reviewed" },
  },
  change_priority: {
    kind: "change_priority",
    scope: ANYWHERE,
    condition: { rows: [], changes: [], fields: [], keys: [], lifecycles: [], priorities: [] },
    action: { type: "mute" },
  },
};

/** A definition of `kind` matching everything, with the given parts replaced (merged one level). */
export function definition<K extends Kind>(
  kind: K,
  parts: {
    scope?: Partial<RuleScope>;
    condition?: Partial<DefinitionOf<K>["condition"]>;
    action?: Partial<DefinitionOf<K>["action"]>;
  } = {},
): DefinitionOf<K> {
  const base = DEFAULTS[kind];
  return {
    ...base,
    scope: { ...base.scope, ...parts.scope },
    condition: { ...base.condition, ...parts.condition },
    action: { ...base.action, ...parts.action },
  };
}

/** A rule written directly, without applying it (the API applies rules on every change). */
export async function createRuleRow(ruleDefinition: RuleDefinition = definition("service")) {
  const position = await prisma.rule.count();
  return prisma.rule.create({
    data: {
      name: `Rule ${Math.floor(Math.random() * 1e9)}`,
      kind: ruleDefinition.kind,
      position,
      definition: ruleDefinition,
    },
  });
}
