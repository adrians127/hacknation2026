import { MAX_TAGS } from "@subsurf/contracts/common/common.schema";
import type { TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";
import {
  RULE_PREVIEW_SAMPLES,
  type RulePreviewItem,
  type RulePreviewResponse,
} from "@subsurf/contracts/rules/rules.schema";

import type { HostTarget, ServiceTarget, TriageSlot } from "~backend/modules/rules/rule-context";
import {
  applyChangeRules,
  matchesChange,
  rulesOfKind,
  type ChangePriorityRule,
  type ChangeRowFacts,
  type CompiledRule,
  type ServiceRule,
} from "~backend/modules/rules/rule-match";
import {
  hostVerdict,
  isUserOwned,
  serviceVerdict,
  triageOf,
  triageRules,
  vulnerabilityVerdict,
  wanted,
  type RuleData,
  type RuleTagRow,
  type TriageRule,
  type Verdict,
  type Wanted,
} from "~backend/modules/rules/rule-plan";

type Outcome = "changes" | "unchanged" | "skipped";
export type PreviewCounts = Omit<RulePreviewResponse, "scan">;

const EMPTY_ITEM = {
  serviceId: null,
  port: null,
  vulnerabilityId: null,
  change: null,
  field: null,
  key: null,
  triage: null,
  tag: null,
  priority: null,
} satisfies Partial<RulePreviewItem>;

class Tally {
  readonly counts: PreviewCounts = {
    matched: 0,
    changes: 0,
    unchanged: 0,
    skipped: 0,
    samples: [],
  };

  add(outcome: Outcome, sample: () => RulePreviewItem): void {
    this.counts.matched++;
    this.counts[outcome]++;
    if (outcome === "changes" && this.counts.samples.length < RULE_PREVIEW_SAMPLES) {
      this.counts.samples.push(sample());
    }
  }
}

/** What the candidate rule does to one value, given the winner among all rules. */
function triageOutcome<V extends string>(
  slot: TriageSlot<V>,
  want: Wanted<V>,
  candidateId: string,
): Outcome {
  if (isUserOwned(slot) || want === null || want === "keep" || want.ruleId !== candidateId) {
    return "skipped";
  }
  return slot.value === want.value && slot.ruleId === want.ruleId ? "unchanged" : "changes";
}

function tagOutcome(
  rule: ServiceRule,
  tags: readonly string[],
  rows: readonly RuleTagRow[] | undefined,
): Outcome | null {
  const { tag } = rule.definition.action;
  if (tag === null) return null;
  if (tags.includes(tag) || rows?.some((row) => row.ruleId === rule.ref.id && row.tag === tag)) {
    return "unchanged";
  }
  return tags.length >= MAX_TAGS ? "skipped" : "changes";
}

/** A target changes when either part does; it is skipped only when nothing would change. */
function combine(parts: readonly (Outcome | null)[]): Outcome {
  if (parts.includes("changes")) return "changes";
  return parts.includes("skipped") ? "skipped" : "unchanged";
}

const isServiceRule = (rule: TriageRule): rule is ServiceRule => rule.definition.kind === "service";

function previewTriageTarget(
  tally: Tally,
  candidate: TriageRule,
  rules: readonly TriageRule[],
  target: { slot: TriageSlot<TriageStatus>; tags: string[] },
  verdictOf: (rule: TriageRule) => Verdict,
  rows: readonly RuleTagRow[] | undefined,
  item: () => RulePreviewItem,
): void {
  if (verdictOf(candidate) !== "match") return;
  const tagRule = isServiceRule(candidate) ? candidate : null;
  const setsTriage = tagRule === null || tagRule.definition.action.triage !== null;
  const want = setsTriage ? wanted(rules, verdictOf, triageOf, target.slot.ruleId) : null;
  const triage = setsTriage ? triageOutcome(target.slot, want, candidate.ref.id) : null;
  const tag = tagRule ? tagOutcome(tagRule, target.tags, rows) : null;
  tally.add(combine([triage, tag]), () => ({
    ...item(),
    triage:
      triage === "changes" && want !== null && want !== "keep"
        ? { before: target.slot.value, after: want.value }
        : null,
    tag: tag === "changes" && tagRule ? tagRule.definition.action.tag : null,
  }));
}

/** What `candidate` (placed among `rules` in order) would set now. */
export function previewTargets(
  candidate: CompiledRule,
  rules: readonly CompiledRule[],
  data: RuleData,
): PreviewCounts {
  const tally = new Tally();
  const definition = candidate.definition;
  const rowsByTarget = Map.groupBy(data.ruleTags, (row) => `${row.targetKind}|${row.targetId}`);

  if (definition.kind === "vulnerability") {
    const vulnerabilityRules = rulesOfKind(rules, "vulnerability");
    const self = vulnerabilityRules.find((rule) => rule.ref.id === candidate.ref.id);
    if (!self) return tally.counts;
    const owners = new Map<string, { host: HostTarget; service: ServiceTarget }>();
    for (const host of data.hosts) {
      for (const service of host.services) owners.set(service.id, { host, service });
    }
    for (const vulnerability of data.vulnerabilities) {
      const owner = owners.get(vulnerability.serviceId);
      if (!owner) continue;
      const verdictOf = (rule: (typeof vulnerabilityRules)[number]) =>
        vulnerabilityVerdict(rule, owner.host, owner.service, vulnerability);
      if (verdictOf(self) !== "match") continue;
      const want = wanted(
        vulnerabilityRules,
        verdictOf,
        (rule) => rule.definition.action.triage,
        vulnerability.triage.ruleId,
      );
      tally.add(triageOutcome(vulnerability.triage, want, self.ref.id), () => ({
        ...EMPTY_ITEM,
        hostId: owner.host.id,
        ip: owner.host.ip,
        serviceId: owner.service.id,
        port: owner.service.port,
        vulnerabilityId: vulnerability.facts.vulnerabilityId,
        triage:
          want !== null && want !== "keep"
            ? { before: vulnerability.triage.value, after: want.value }
            : null,
      }));
    }
    return tally.counts;
  }

  if (definition.kind !== "service" && definition.kind !== "unchanged") return tally.counts;
  const target = definition.condition.target;
  const ordered = triageRules(rules, target);
  const self = [...rulesOfKind(rules, "service"), ...rulesOfKind(rules, "unchanged")].find(
    (rule) => rule.ref.id === candidate.ref.id,
  );
  if (!self) return tally.counts;
  for (const host of data.hosts) {
    if (target === "host") {
      previewTriageTarget(
        tally,
        self,
        ordered,
        { slot: host.triage, tags: host.tags },
        (rule) => hostVerdict(rule, host, data.history),
        rowsByTarget.get(`host|${host.id}`),
        () => ({ ...EMPTY_ITEM, hostId: host.id, ip: host.ip }),
      );
      continue;
    }
    for (const service of host.services) {
      previewTriageTarget(
        tally,
        self,
        ordered,
        { slot: service.triage, tags: service.tags },
        (rule) => serviceVerdict(rule, host, service, data.history),
        rowsByTarget.get(`service|${service.id}`),
        () => ({
          ...EMPTY_ITEM,
          hostId: host.id,
          ip: host.ip,
          serviceId: service.id,
          port: service.port,
        }),
      );
    }
  }
  return tally.counts;
}

/** What `candidate` would do to the changes of one scan (`facts`, rated by the built-in rules). */
export function previewChanges(
  candidate: ChangePriorityRule,
  rules: readonly ChangePriorityRule[],
  facts: readonly ChangeRowFacts[],
): PreviewCounts {
  const tally = new Tally();
  for (const fact of facts) {
    if (!matchesChange(candidate, fact)) continue;
    const final = applyChangeRules(fact, rules);
    const outcome: Outcome =
      final.rule?.id !== candidate.ref.id
        ? "skipped"
        : final.muted || final.priority !== fact.row.priority
          ? "changes"
          : "unchanged";
    tally.add(outcome, () => ({
      ...EMPTY_ITEM,
      hostId: fact.row.hostId,
      ip: fact.row.ip,
      port: fact.row.port,
      change: fact.row.change,
      field: fact.row.field,
      key: fact.row.key,
      priority: { before: fact.row.priority, after: final.muted ? "muted" : final.priority },
    }));
  }
  return tally.counts;
}
