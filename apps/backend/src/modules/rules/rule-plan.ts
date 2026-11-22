import { MAX_TAGS } from "@subsurf/contracts/common/common.schema";
import type { TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";
import type { ScanChange } from "@subsurf/contracts/scans/scan-results.schema";
import type { VulnerabilityTriageStatus } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import type {
  HostTarget,
  ServiceTarget,
  TriageSlot,
  VulnerabilityTarget,
} from "~backend/modules/rules/rule-context";
import {
  matchesHost,
  matchesService,
  matchesVulnerability,
  rulesOfKind,
  type CompiledRule,
  type ServiceRule,
  type UnchangedRule,
  type VulnerabilityRule,
} from "~backend/modules/rules/rule-match";

/** `unknown`: the latest scans give no conclusive answer, so a value the rule set stays. */
export type Verdict = "match" | "miss" | "unknown";

/** Changes in the latest scans with results, newest first: index 0 is the newest against its base. */
export interface ChangeHistory {
  hosts: ReadonlyMap<string, ScanChange | null>[];
  services: ReadonlyMap<string, ScanChange | null>[];
}

export const NO_HISTORY: ChangeHistory = { hosts: [], services: [] };

export interface RuleTagRow {
  id: string;
  ruleId: string;
  targetKind: "host" | "service";
  targetId: string;
  tag: string;
}

export interface RuleData {
  hosts: HostTarget[];
  vulnerabilities: VulnerabilityTarget[];
  ruleTags: RuleTagRow[];
  history: ChangeHistory;
}

export interface TriageWrite {
  id: string;
  from: TriageSlot<TriageStatus>;
  to: TriageSlot<TriageStatus>;
}

export interface VulnerabilityTriageWrite {
  serviceId: string;
  vulnerabilityId: string;
  hasRow: boolean;
  from: TriageSlot<VulnerabilityTriageStatus>;
  to: TriageSlot<VulnerabilityTriageStatus>;
}

export interface TagWrite {
  kind: "host" | "service";
  id: string;
  before: string[];
  after: string[];
  /** Rows to record once the tags are written. */
  add: { ruleId: string; tag: string }[];
  /** Rows to delete once the tags are written. */
  drop: string[];
}

export interface RulePlan {
  hostTriage: TriageWrite[];
  serviceTriage: TriageWrite[];
  vulnerabilityTriage: VulnerabilityTriageWrite[];
  tags: TagWrite[];
  /** Rows of tags the rule no longer holds where the target's tags do not change. */
  dropRuleTags: string[];
}

export type TriageRule = ServiceRule | UnchangedRule;

/** Rules that set the triage of a service, or of a host, in order. */
export function triageRules(rules: readonly CompiledRule[], target: "service" | "host") {
  return [...rulesOfKind(rules, "service"), ...rulesOfKind(rules, "unchanged")]
    .filter(
      (rule) =>
        rule.definition.condition.target === target &&
        (rule.definition.kind === "unchanged" || rule.definition.action.triage !== null),
    )
    .toSorted((a, b) => rules.indexOf(a) - rules.indexOf(b));
}

export const tagRules = (rules: readonly CompiledRule[], target: "service" | "host") =>
  rulesOfKind(rules, "service").filter(
    (rule) => rule.definition.condition.target === target && rule.definition.action.tag !== null,
  );

export function triageOf(rule: TriageRule): TriageStatus {
  const { triage } = rule.definition.action;
  // triageRules() keeps only `service` rules with a triage.
  if (triage === null) throw new Error(`Rule ${rule.ref.id} sets no triage`);
  return triage;
}

/** Unchanged in each of the rule's latest scans (any change = miss, no answer = unknown). */
function unchangedVerdict(
  scans: number,
  changesOf: readonly ReadonlyMap<string, ScanChange | null>[],
  id: string,
): Verdict {
  if (changesOf.length < scans) return "unknown";
  let isKnown = true;
  for (const changes of changesOf.slice(0, scans)) {
    const change = changes.get(id);
    if (change === "new" || change === "gone" || change === "changed") return "miss";
    if (change !== "unchanged") isKnown = false;
  }
  return isKnown ? "match" : "unknown";
}

export function serviceVerdict(
  rule: TriageRule,
  host: HostTarget,
  service: ServiceTarget,
  history: ChangeHistory,
): Verdict {
  if (!matchesService(rule, host.facts, service.facts)) return "miss";
  return rule.definition.kind === "service"
    ? "match"
    : unchangedVerdict(rule.definition.condition.scans, history.services, service.id);
}

export function hostVerdict(rule: TriageRule, host: HostTarget, history: ChangeHistory): Verdict {
  const services = host.services.map((service) => service.facts);
  if (!matchesHost(rule, host.facts, services)) return "miss";
  return rule.definition.kind === "service"
    ? "match"
    : unchangedVerdict(rule.definition.condition.scans, history.hosts, host.id);
}

export function vulnerabilityVerdict(
  rule: VulnerabilityRule,
  host: HostTarget,
  service: ServiceTarget,
  vulnerability: VulnerabilityTarget,
): Verdict {
  return matchesVulnerability(rule, host.facts, service.facts, vulnerability.facts)
    ? "match"
    : "miss";
}

/** What a value should be: set by a rule, kept as an unsure rule left it, or no rule's. */
export type Wanted<V extends string> = { ruleId: string; value: V } | "keep" | null;

/** The first rule that matches wins; one with no answer keeps only the value it set itself. */
export function wanted<R extends CompiledRule, V extends string>(
  rules: readonly R[],
  verdictOf: (rule: R) => Verdict,
  valueOf: (rule: R) => V,
  owner: string | null,
): Wanted<V> {
  for (const rule of rules) {
    const verdict = verdictOf(rule);
    if (verdict === "match") return { ruleId: rule.ref.id, value: valueOf(rule) };
    if (verdict === "unknown" && rule.ref.id === owner) return "keep";
  }
  return null;
}

/** A value a user set (or anything other than a rule changed from `unreviewed`). */
export const isUserOwned = (slot: TriageSlot<string>) =>
  slot.ruleId === null && slot.value !== "unreviewed";

/** The value to write, or `null` to leave it. Rules never touch what users set. */
export function settle<V extends string>(
  slot: TriageSlot<V>,
  want: Wanted<V>,
  unreviewed: V,
): TriageSlot<V> | null {
  if (isUserOwned(slot) || want === "keep") return null;
  if (want === null) return slot.ruleId === null ? null : { value: unreviewed, ruleId: null };
  return slot.value === want.value && slot.ruleId === want.ruleId
    ? null
    : { value: want.value, ruleId: want.ruleId };
}

const tagOf = (rule: ServiceRule) => rule.definition.action.tag;

/** Tags of matching rules are added once; a rule's tag goes when the rule no longer matches. */
export function planTags(
  target: { kind: "host" | "service"; id: string; tags: readonly string[] },
  matching: readonly ServiceRule[],
  rows: readonly RuleTagRow[],
): { write: TagWrite | null; drop: string[] } {
  const held = rows.filter((row) => matching.some((rule) => rule.ref.id === row.ruleId && tagOf(rule) === row.tag));
  const released = rows.filter((row) => !held.includes(row));
  const wantedTags = new Set(matching.map(tagOf));
  let after = target.tags.filter(
    (tag) => wantedTags.has(tag) || !released.some((row) => row.tag === tag),
  );
  const add: { ruleId: string; tag: string }[] = [];
  for (const rule of matching) {
    const tag = tagOf(rule);
    if (tag === null || held.some((row) => row.ruleId === rule.ref.id)) continue;
    // A tag the target already has is not the rule's: it stays when the rule goes.
    if (after.includes(tag) || after.length >= MAX_TAGS) continue;
    after = [...after, tag];
    add.push({ ruleId: rule.ref.id, tag });
  }
  const drop = released.map((row) => row.id);
  const isChanged = after.length !== target.tags.length || after.some((tag, i) => tag !== target.tags[i]);
  if (!isChanged) return { write: null, drop };
  return {
    write: { kind: target.kind, id: target.id, before: [...target.tags], after, add, drop },
    drop: [],
  };
}

/** Every write that brings the stored values in line with the rules (given in order). */
export function planRules(rules: readonly CompiledRule[], data: RuleData): RulePlan {
  const plan: RulePlan = {
    hostTriage: [],
    serviceTriage: [],
    vulnerabilityTriage: [],
    tags: [],
    dropRuleTags: [],
  };
  const hostRules = triageRules(rules, "host");
  const serviceRules = triageRules(rules, "service");
  const hostTagRules = tagRules(rules, "host");
  const serviceTagRules = tagRules(rules, "service");
  const vulnerabilityRules = rulesOfKind(rules, "vulnerability");
  const rowsByTarget = Map.groupBy(data.ruleTags, (row) => `${row.targetKind}|${row.targetId}`);
  const applyTags = (result: ReturnType<typeof planTags>) => {
    if (result.write) plan.tags.push(result.write);
    plan.dropRuleTags.push(...result.drop);
  };

  const serviceById = new Map<string, { host: HostTarget; service: ServiceTarget }>();
  for (const host of data.hosts) {
    const hostSlot = settle(
      host.triage,
      wanted(hostRules, (rule) => hostVerdict(rule, host, data.history), triageOf, host.triage.ruleId),
      "unreviewed",
    );
    if (hostSlot) plan.hostTriage.push({ id: host.id, from: host.triage, to: hostSlot });
    const services = host.services.map((service) => service.facts);
    applyTags(
      planTags(
        { kind: "host", id: host.id, tags: host.tags },
        hostTagRules.filter((rule) => matchesHost(rule, host.facts, services)),
        rowsByTarget.get(`host|${host.id}`) ?? [],
      ),
    );

    for (const service of host.services) {
      serviceById.set(service.id, { host, service });
      const slot = settle(
        service.triage,
        wanted(
          serviceRules,
          (rule) => serviceVerdict(rule, host, service, data.history),
          triageOf,
          service.triage.ruleId,
        ),
        "unreviewed",
      );
      if (slot) plan.serviceTriage.push({ id: service.id, from: service.triage, to: slot });
      applyTags(
        planTags(
          { kind: "service", id: service.id, tags: service.tags },
          serviceTagRules.filter((rule) => matchesService(rule, host.facts, service.facts)),
          rowsByTarget.get(`service|${service.id}`) ?? [],
        ),
      );
    }
  }

  // Rows of tags whose target is gone (never deleted today, but no foreign key guards it).
  const known = new Set([
    ...data.hosts.map((host) => `host|${host.id}`),
    ...[...serviceById.keys()].map((id) => `service|${id}`),
  ]);
  for (const [key, rows] of rowsByTarget) {
    if (!known.has(key)) plan.dropRuleTags.push(...rows.map((row) => row.id));
  }

  for (const vulnerability of data.vulnerabilities) {
    const owner = serviceById.get(vulnerability.serviceId);
    if (!owner) continue;
    const slot = settle(
      vulnerability.triage,
      wanted(
        vulnerabilityRules,
        (rule) => vulnerabilityVerdict(rule, owner.host, owner.service, vulnerability),
        (rule) => rule.definition.action.triage,
        vulnerability.triage.ruleId,
      ),
      "unreviewed",
    );
    if (slot) {
      plan.vulnerabilityTriage.push({
        serviceId: vulnerability.serviceId,
        vulnerabilityId: vulnerability.facts.vulnerabilityId,
        hasRow: vulnerability.hasRow,
        from: vulnerability.triage,
        to: slot,
      });
    }
  }
  return plan;
}
