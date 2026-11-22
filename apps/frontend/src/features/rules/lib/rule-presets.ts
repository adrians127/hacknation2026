import type {
  ChangePriorityCondition,
  RuleDefinition,
  RuleScope,
  VulnerabilityCondition,
} from "@subsurf/contracts/rules/rules.schema";

const ANYWHERE: RuleScope = { ranges: [], hostTags: [], ports: [], products: [] };

const ANY_VULNERABILITY: VulnerabilityCondition = {
  vulnerabilityIds: [],
  severities: [],
  cvssAtLeast: null,
  cvssBelow: null,
  kev: null,
  confidence: null,
  reasons: [],
};

const ANY_CHANGE: ChangePriorityCondition = {
  rows: [],
  changes: [],
  fields: [],
  keys: [],
  lifecycles: [],
  priorities: [],
};

/** Starting points of the rule form; names and descriptions are `rules:presets.<id>`. */
export const RULE_PRESETS = {
  ignoreCve: {
    kind: "vulnerability",
    scope: { ...ANYWHERE, ranges: ["10.0.0.0/8"], products: ["OpenSSH"] },
    condition: { ...ANY_VULNERABILITY, vulnerabilityIds: ["CVE-2023-48795"] },
    action: { triage: "accepted_risk" },
  },
  ignoreBackports: {
    kind: "vulnerability",
    scope: ANYWHERE,
    condition: {
      ...ANY_VULNERABILITY,
      confidence: "potential",
      reasons: ["distro_backport_possible", "fixed_by_backport"],
    },
    action: { triage: "false_positive" },
  },
  lowSeverity: {
    kind: "vulnerability",
    scope: { ...ANYWHERE, hostTags: ["lab"] },
    condition: { ...ANY_VULNERABILITY, cvssBelow: 4 },
    action: { triage: "accepted_risk" },
  },
  escalateKev: {
    kind: "vulnerability",
    scope: ANYWHERE,
    condition: { ...ANY_VULNERABILITY, kev: true },
    action: { triage: "important" },
  },
  unchangedReviewed: {
    kind: "unchanged",
    scope: ANYWHERE,
    condition: { target: "service", scans: 2 },
    action: { triage: "reviewed" },
  },
  muteCertRotation: {
    kind: "change_priority",
    scope: ANYWHERE,
    condition: { ...ANY_CHANGE, fields: ["tls.cert", "tls.expiry", "tls.issuer"] },
    action: { type: "mute" },
  },
  muteUnstable: {
    kind: "change_priority",
    scope: ANYWHERE,
    condition: { ...ANY_CHANGE, changes: ["gone", "unknown"], lifecycles: ["unstable"] },
    action: { type: "mute" },
  },
  riskyPortHigh: {
    kind: "change_priority",
    scope: { ...ANYWHERE, ports: [23, 445, 3389, 5900] },
    condition: { ...ANY_CHANGE, rows: ["service"], changes: ["new"] },
    action: { type: "priority", priority: "high" },
  },
  adminPanels: {
    kind: "service",
    scope: ANYWHERE,
    condition: { target: "service", titles: ["admin", "phpmyadmin", "login"] },
    action: { triage: "important", tag: "admin-panel" },
  },
  tagDatabases: {
    kind: "service",
    scope: { ...ANYWHERE, ports: [1433, 3306, 5432, 6379, 27017] },
    condition: { target: "service", titles: [] },
    action: { triage: null, tag: "database" },
  },
} satisfies Record<string, RuleDefinition>;

export type RulePresetId = keyof typeof RULE_PRESETS;

export const RULE_PRESET_IDS = Object.keys(RULE_PRESETS).filter(
  (key): key is RulePresetId => key in RULE_PRESETS,
);
