import { selectorRanges } from "@subsurf/contracts/hosts/host-selectors";
import type { RuleRef } from "@subsurf/contracts/rules/rule-ref.schema";
import {
  RuleDefinitionSchema,
  type ChangeRowKind,
  type RuleDefinition,
} from "@subsurf/contracts/rules/rules.schema";
import type { ScanChangeRow } from "@subsurf/contracts/scans/scan-changes.schema";
import type { Ipv4Range } from "@subsurf/contracts/targets/ipv4";
import type {
  MatchConfidence,
  MatchReason,
  VulnerabilitySeverity,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

type Definition<K extends RuleDefinition["kind"]> = Extract<RuleDefinition, { kind: K }>;

/** A stored rule as the engine needs it. */
export interface RuleRow {
  id: string;
  name: string;
  enabled: boolean;
  expiresAt: Date | null;
  definition: unknown;
}

/** An enabled, unexpired rule with its scope prepared for matching. */
export interface CompiledRule<D extends RuleDefinition = RuleDefinition> {
  ref: RuleRef;
  definition: D;
  ranges: Ipv4Range[];
  products: string[];
}

export type VulnerabilityRule = CompiledRule<Definition<"vulnerability">>;
export type ServiceRule = CompiledRule<Definition<"service">>;
export type UnchangedRule = CompiledRule<Definition<"unchanged">>;
export type ChangePriorityRule = CompiledRule<Definition<"change_priority">>;

export const isRuleActive = (rule: Pick<RuleRow, "enabled" | "expiresAt">, now: Date) =>
  rule.enabled && (rule.expiresAt === null || rule.expiresAt > now);

const lower = (values: readonly string[]) => values.map((value) => value.toLowerCase());

export function compileRule<D extends RuleDefinition>(ref: RuleRef, definition: D): CompiledRule<D> {
  return {
    ref,
    definition,
    ranges: selectorRanges(definition.scope.ranges),
    products: lower(definition.scope.products),
  };
}

/** The active rules, in the order given (by `position`). */
export function compileRules(rows: readonly RuleRow[], now: Date): CompiledRule[] {
  return rows
    .filter((row) => isRuleActive(row, now))
    .map((row) =>
      compileRule({ id: row.id, name: row.name }, RuleDefinitionSchema.parse(row.definition)),
    );
}

export function rulesOfKind<K extends RuleDefinition["kind"]>(
  rules: readonly CompiledRule[],
  kind: K,
): CompiledRule<Definition<K>>[] {
  return rules.filter((rule): rule is CompiledRule<Definition<K>> => rule.definition.kind === kind);
}

/** What host-level scope fields look at. */
export interface HostFacts {
  ipNumber: number;
  tags: readonly string[];
}

/** What service-level scope fields and conditions look at; texts lowercased. */
export interface ServiceFacts {
  port: number;
  /** The name and product: the user's correction if any, else the newest observation. */
  names: readonly string[];
  titles: readonly string[];
}

interface Identity {
  name: string | null;
  product: string | null;
}

export function serviceFacts(
  port: number,
  corrected: Identity,
  observed: Identity,
  titles: readonly (string | null)[] = [],
): ServiceFacts {
  return {
    port,
    names: [corrected.name ?? observed.name, corrected.product ?? observed.product].flatMap(
      (value) => (value ? [value.toLowerCase()] : []),
    ),
    titles: titles.flatMap((title) => (title ? [title.toLowerCase()] : [])),
  };
}

function inRanges(ranges: readonly Ipv4Range[], address: number): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (!range) return false;
    if (address < range.start) high = middle - 1;
    else if (address > range.end) low = middle + 1;
    else return true;
  }
  return false;
}

const containsAny = (texts: readonly string[], parts: readonly string[]) =>
  parts.length === 0 || texts.some((text) => parts.some((part) => text.includes(part)));

export function hostInScope(rule: CompiledRule, host: HostFacts): boolean {
  const { hostTags } = rule.definition.scope;
  return (
    (rule.ranges.length === 0 || inRanges(rule.ranges, host.ipNumber)) &&
    (hostTags.length === 0 || hostTags.some((tag) => host.tags.includes(tag)))
  );
}

/** Whether the rule looks at services at all (a host-wide row or target needs one that matches). */
function hasServiceScope(rule: CompiledRule): boolean {
  const { scope } = rule.definition;
  return (
    scope.ports.length > 0 ||
    scope.products.length > 0 ||
    (rule.definition.kind === "service" && rule.definition.condition.titles.length > 0)
  );
}

function serviceInScope(rule: CompiledRule, service: ServiceFacts): boolean {
  const { ports } = rule.definition.scope;
  return (
    (ports.length === 0 || ports.includes(service.port)) && containsAny(service.names, rule.products)
  );
}

function serviceMatches(rule: CompiledRule, service: ServiceFacts): boolean {
  if (!serviceInScope(rule, service)) return false;
  if (rule.definition.kind !== "service") return true;
  return containsAny(service.titles, lower(rule.definition.condition.titles));
}

/** A `service` rule targeting services (or an `unchanged` one's scope) on one service. */
export const matchesService = (
  rule: ServiceRule | UnchangedRule,
  host: HostFacts,
  service: ServiceFacts,
) => hostInScope(rule, host) && serviceMatches(rule, service);

/** A rule targeting hosts: host-level scope, and through any service when it names services. */
export const matchesHost = (
  rule: ServiceRule | UnchangedRule,
  host: HostFacts,
  services: readonly ServiceFacts[],
) =>
  hostInScope(rule, host) &&
  (!hasServiceScope(rule) || services.some((service) => serviceMatches(rule, service)));

/** An active vulnerability match of a service. */
export interface VulnerabilityFacts {
  vulnerabilityId: string;
  severity: VulnerabilitySeverity;
  cvssScore: number | null;
  kev: boolean;
  confidence: MatchConfidence;
  reasons: readonly MatchReason[];
}

export function matchesVulnerability(
  rule: VulnerabilityRule,
  host: HostFacts,
  service: ServiceFacts,
  vulnerability: VulnerabilityFacts,
): boolean {
  if (!hostInScope(rule, host) || !serviceInScope(rule, service)) return false;
  const condition = rule.definition.condition;
  const id = vulnerability.vulnerabilityId.toUpperCase();
  const score = vulnerability.cvssScore;
  return (
    (condition.vulnerabilityIds.length === 0 ||
      condition.vulnerabilityIds.some((candidate) => candidate.toUpperCase() === id)) &&
    (condition.severities.length === 0 || condition.severities.includes(vulnerability.severity)) &&
    (condition.cvssAtLeast === null || (score !== null && score >= condition.cvssAtLeast)) &&
    (condition.cvssBelow === null || (score !== null && score < condition.cvssBelow)) &&
    (condition.kev === null || condition.kev === vulnerability.kev) &&
    (condition.confidence === null || condition.confidence === vulnerability.confidence) &&
    (condition.reasons.length === 0 ||
      condition.reasons.some((reason) => vulnerability.reasons.includes(reason)))
  );
}

export const changeRowKind = (row: Pick<ScanChangeRow, "field" | "port">): ChangeRowKind =>
  row.field !== null ? "field" : row.port === null ? "host" : "service";

/** A change row as the built-in rating left it, with its host and (for a port) service. */
export interface ChangeRowFacts {
  row: ScanChangeRow;
  host: HostFacts;
  /** `null` for a host-wide row. */
  service: ServiceFacts | null;
}

export function matchesChange(rule: ChangePriorityRule, { row, host, service }: ChangeRowFacts) {
  if (!hostInScope(rule, host)) return false;
  if (hasServiceScope(rule) && (service === null || !serviceInScope(rule, service))) return false;
  const condition = rule.definition.condition;
  const key = row.key?.toLowerCase() ?? null;
  return (
    (condition.rows.length === 0 || condition.rows.includes(changeRowKind(row))) &&
    (condition.changes.length === 0 ||
      condition.changes.some((change) => change === row.change)) &&
    (condition.fields.length === 0 || (row.field !== null && condition.fields.includes(row.field))) &&
    (condition.keys.length === 0 ||
      (key !== null && lower(condition.keys).some((part) => key.includes(part)))) &&
    (condition.lifecycles.length === 0 || condition.lifecycles.includes(row.lifecycle.state)) &&
    (condition.priorities.length === 0 || condition.priorities.includes(row.priority))
  );
}

/** The row as the first matching rule leaves it: re-rated or muted, and which rule did it. */
export function applyChangeRules(
  facts: ChangeRowFacts,
  rules: readonly ChangePriorityRule[],
): ScanChangeRow {
  const rule = rules.find((candidate) => matchesChange(candidate, facts));
  if (!rule) return facts.row;
  const { action } = rule.definition;
  return action.type === "mute"
    ? { ...facts.row, muted: true, rule: rule.ref }
    : { ...facts.row, priority: action.priority, rule: rule.ref };
}
