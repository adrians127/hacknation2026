import type {
  ChangePriorityCondition,
  RuleDefinition,
  RuleKind,
  RuleTarget,
  VulnerabilityCondition,
} from "@subsurf/contracts/rules/rules.schema";
import type { ChangePriority } from "@subsurf/contracts/scans/scan-changes.schema";
import type { TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";
import type { VulnerabilityTriageStatus } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

type SetTriage = Exclude<TriageStatus, "unreviewed">;
type SetVulnerabilityTriage = Exclude<VulnerabilityTriageStatus, "unreviewed">;

/**
 * Everything the rule form edits. Lists stay text while the user types; every kind keeps its own
 * fields, so switching the kind back and forth loses nothing.
 */
export interface RuleFormState {
  kind: RuleKind;
  scope: { ranges: string; hostTags: string; ports: string; products: string };
  vulnerability: {
    ids: string;
    severities: VulnerabilityCondition["severities"];
    cvssAtLeast: string;
    cvssBelow: string;
    kev: "any" | "yes" | "no";
    confidence: "any" | NonNullable<VulnerabilityCondition["confidence"]>;
    reasons: VulnerabilityCondition["reasons"];
    triage: SetVulnerabilityTriage;
  };
  service: { target: RuleTarget; titles: string; triage: SetTriage | "none"; tag: string };
  unchanged: { target: RuleTarget; scans: string; triage: SetTriage };
  change: Omit<ChangePriorityCondition, "keys"> & { keys: string; action: "mute" | ChangePriority };
}

export const EMPTY_FORM: RuleFormState = {
  kind: "vulnerability",
  scope: { ranges: "", hostTags: "", ports: "", products: "" },
  vulnerability: {
    ids: "",
    severities: [],
    cvssAtLeast: "",
    cvssBelow: "",
    kev: "any",
    confidence: "any",
    reasons: [],
    triage: "false_positive",
  },
  service: { target: "service", titles: "", triage: "important", tag: "" },
  unchanged: { target: "service", scans: "1", triage: "reviewed" },
  change: {
    rows: [],
    changes: [],
    fields: [],
    keys: "",
    lifecycles: [],
    priorities: [],
    action: "mute",
  },
};

/** Tokens separated by spaces, commas, semicolons or new lines (addresses, ids, ports). */
const words = (text: string) => text.split(/[\s,;]+/).filter(Boolean);
/** Entries separated by commas or new lines; spaces inside stay ("Microsoft Exchange"). */
const entries = (text: string) =>
  text
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
const joinWords = (values: readonly (string | number)[]) => values.join(", ");
const optionalNumber = (text: string) => (text.trim() === "" ? null : Number(text));

export function toFormState(definition: RuleDefinition): RuleFormState {
  const scope = {
    ranges: definition.scope.ranges.join("\n"),
    hostTags: joinWords(definition.scope.hostTags),
    ports: joinWords(definition.scope.ports),
    products: joinWords(definition.scope.products),
  };
  const state: RuleFormState = { ...EMPTY_FORM, kind: definition.kind, scope };
  switch (definition.kind) {
    case "vulnerability": {
      const { condition } = definition;
      return {
        ...state,
        vulnerability: {
          ids: condition.vulnerabilityIds.join("\n"),
          severities: condition.severities,
          cvssAtLeast: condition.cvssAtLeast === null ? "" : String(condition.cvssAtLeast),
          cvssBelow: condition.cvssBelow === null ? "" : String(condition.cvssBelow),
          kev: condition.kev === null ? "any" : condition.kev ? "yes" : "no",
          confidence: condition.confidence ?? "any",
          reasons: condition.reasons,
          triage: definition.action.triage,
        },
      };
    }
    case "service":
      return {
        ...state,
        service: {
          target: definition.condition.target,
          titles: joinWords(definition.condition.titles),
          triage: definition.action.triage ?? "none",
          tag: definition.action.tag ?? "",
        },
      };
    case "unchanged":
      return {
        ...state,
        unchanged: {
          target: definition.condition.target,
          scans: String(definition.condition.scans),
          triage: definition.action.triage,
        },
      };
    default: {
      const { condition, action } = definition;
      return {
        ...state,
        change: {
          ...condition,
          keys: joinWords(condition.keys),
          action: action.type === "mute" ? "mute" : action.priority,
        },
      };
    }
  }
}

/** The definition the form describes; not validated (`RuleDefinitionSchema` does that). */
export function toDefinition(state: RuleFormState): RuleDefinition {
  const scope = {
    ranges: words(state.scope.ranges),
    hostTags: entries(state.scope.hostTags),
    ports: words(state.scope.ports).map(Number),
    products: entries(state.scope.products),
  };
  switch (state.kind) {
    case "vulnerability": {
      const form = state.vulnerability;
      return {
        kind: "vulnerability",
        scope,
        condition: {
          vulnerabilityIds: words(form.ids),
          severities: form.severities,
          cvssAtLeast: optionalNumber(form.cvssAtLeast),
          cvssBelow: optionalNumber(form.cvssBelow),
          kev: form.kev === "any" ? null : form.kev === "yes",
          confidence: form.confidence === "any" ? null : form.confidence,
          reasons: form.reasons,
        },
        action: { triage: form.triage },
      };
    }
    case "service": {
      const form = state.service;
      const tag = form.tag.trim();
      return {
        kind: "service",
        scope,
        condition: { target: form.target, titles: entries(form.titles) },
        action: { triage: form.triage === "none" ? null : form.triage, tag: tag === "" ? null : tag },
      };
    }
    case "unchanged":
      return {
        kind: "unchanged",
        scope,
        condition: { target: state.unchanged.target, scans: Number(state.unchanged.scans) },
        action: { triage: state.unchanged.triage },
      };
    default: {
      const { action, keys, ...condition } = state.change;
      return {
        kind: "change_priority",
        scope,
        condition: { ...condition, keys: entries(keys) },
        action: action === "mute" ? { type: "mute" } : { type: "priority", priority: action },
      };
    }
  }
}

/** Where a validation issue belongs in the form: `scope.ports`, `condition.cvssBelow`, `action`… */
export function issueField(path: readonly PropertyKey[]): string {
  const [section, field] = path;
  if (section === "definition") return issueField(path.slice(1));
  return field === undefined || typeof field === "number" ? String(section) : `${String(section)}.${String(field)}`;
}
