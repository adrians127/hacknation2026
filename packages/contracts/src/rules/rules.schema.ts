import { z } from "zod";

import { MAX_TAGS, NonBlankStringSchema, TagSchema } from "../common/common.schema";
import { HostSelectorSchema } from "../hosts/host-selectors";
import { AssetNoteSchema, TriageStatusSchema } from "../hosts/hosts.schema";
import { ChangePrioritySchema } from "../scans/scan-changes.schema";
import {
  FieldChangeKindSchema,
  HostLifecycleStateSchema,
  ScanChangeSchema,
} from "../scans/scan-results.schema";
import {
  MatchConfidenceSchema,
  MatchReasonSchema,
  VulnerabilitySeveritySchema,
  VulnerabilityTriageStatusSchema,
} from "../vulnerabilities/vulnerabilities.schema";

const CountSchema = z.number().int().nonnegative();
const TimestampSchema = z.iso.datetime();
const LIST_MAX = 100;

/**
 * - `vulnerability`: sets the triage of matching vulnerabilities of services (ignore or escalate);
 * - `service`: sets the triage of matching services or hosts and/or tags them;
 * - `unchanged`: sets the triage of services or hosts that did not change in the latest scans;
 * - `change_priority`: re-rates or mutes matching changes between two scans, when they are read.
 */
export const RuleKindSchema = z.enum(["vulnerability", "service", "unchanged", "change_priority"]);

/** What a `service` or `unchanged` rule sets: the service, or the host itself. */
export const RuleTargetSchema = z.enum(["service", "host"]);

const PortSchema = z.number().int().min(1).max(65535);
/** Compared as a part of the text, ignoring case. */
const TextPartSchema = NonBlankStringSchema.max(100);

/**
 * Where a rule applies; every non-empty list must match (empty = anywhere). Host-level fields
 * (`ranges`, `hostTags`) always apply; `ports` and `products` need a service, so a host-wide
 * change or a host target only matches through one of its services.
 */
export const RuleScopeSchema = z.object({
  /** IPv4 addresses and CIDR blocks the host is in. */
  ranges: z.array(HostSelectorSchema).max(LIST_MAX),
  /** The host carries any of them. */
  hostTags: z.array(TagSchema).max(MAX_TAGS),
  ports: z.array(PortSchema).max(LIST_MAX),
  /** Part of the service's name or product: the user's correction if there is one, else the newest observation. */
  products: z.array(TextPartSchema).max(20),
});

/** A CVE or another source's id, as the vulnerability triage endpoint accepts it. */
export const RuleVulnerabilityIdSchema = z.string().regex(/^[A-Za-z0-9:_.-]{1,100}$/);
const CvssSchema = z.number().min(0).max(10);

/** Every non-empty list and non-null value must match an active vulnerability match. */
export const VulnerabilityConditionSchema = z.object({
  /** Canonical ids (CVE), ignoring case. */
  vulnerabilityIds: z.array(RuleVulnerabilityIdSchema).max(500),
  severities: z.array(VulnerabilitySeveritySchema),
  /** CVSS score at least this; a match without a score does not qualify. */
  cvssAtLeast: CvssSchema.nullable(),
  /** CVSS score below this; a match without a score does not qualify. */
  cvssBelow: CvssSchema.nullable(),
  /** `true`: only CISA KEV ones; `false`: only the others. */
  kev: z.boolean().nullable(),
  confidence: MatchConfidenceSchema.nullable(),
  /** Any of these reasons of a `potential` match. */
  reasons: z.array(MatchReasonSchema),
});

export const RuleVulnerabilityTriageSchema = VulnerabilityTriageStatusSchema.exclude(["unreviewed"]);
export const RuleTriageSchema = TriageStatusSchema.exclude(["unreviewed"]);

export const ServiceConditionSchema = z.object({
  target: RuleTargetSchema,
  /** Part of an HTTP page title of the service, ignoring case. */
  titles: z.array(TextPartSchema).max(20),
});

export const ServiceActionSchema = z
  .object({ triage: RuleTriageSchema.nullable(), tag: TagSchema.nullable() })
  .refine((action) => action.triage !== null || action.tag !== null, {
    message: "Set a triage, a tag or both",
  });

/** How many of the latest scans with results an `unchanged` rule may look at. */
export const UNCHANGED_SCANS_MAX = 5;

export const UnchangedConditionSchema = z.object({
  target: RuleTargetSchema,
  /** Unchanged in each of the latest `scans` scans with results, each against its base scan. */
  scans: z.number().int().min(1).max(UNCHANGED_SCANS_MAX),
});

/** The three kinds of change rows (`ScanChangeRowSchema`): a whole host, a port, one field. */
export const ChangeRowKindSchema = z.enum(["host", "service", "field"]);

/** Every non-empty list must match a change row. */
export const ChangePriorityConditionSchema = z.object({
  rows: z.array(ChangeRowKindSchema),
  changes: z.array(ScanChangeSchema.exclude(["unchanged"])),
  fields: z.array(FieldChangeKindSchema),
  /** Part of the header name, cookie name or probe path of a field row, ignoring case. */
  keys: z.array(TextPartSchema).max(LIST_MAX),
  lifecycles: z.array(HostLifecycleStateSchema),
  /** The priority the built-in rating gave the row. */
  priorities: z.array(ChangePrioritySchema),
});

export const ChangePriorityActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("priority"), priority: ChangePrioritySchema }),
  /** Left out of the dashboard; the change export keeps the row with `muted: true`. */
  z.object({ type: z.literal("mute") }),
]);

export const RuleDefinitionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("vulnerability"),
    scope: RuleScopeSchema,
    condition: VulnerabilityConditionSchema,
    action: z.object({ triage: RuleVulnerabilityTriageSchema }),
  }),
  z.object({
    kind: z.literal("service"),
    scope: RuleScopeSchema,
    condition: ServiceConditionSchema,
    action: ServiceActionSchema,
  }),
  z.object({
    kind: z.literal("unchanged"),
    scope: RuleScopeSchema,
    condition: UnchangedConditionSchema,
    action: z.object({ triage: RuleTriageSchema }),
  }),
  z.object({
    kind: z.literal("change_priority"),
    scope: RuleScopeSchema,
    condition: ChangePriorityConditionSchema,
    action: ChangePriorityActionSchema,
  }),
]);

export const RuleNameSchema = NonBlankStringSchema.max(100);

/** What the rule holds now: values it set and tags it added. */
export const RuleAffectedSchema = z.object({
  hosts: CountSchema,
  services: CountSchema,
  vulnerabilities: CountSchema,
  tags: CountSchema,
});

export const RuleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Free text from users (why the rule exists); empty when there is none. */
  note: z.string(),
  enabled: z.boolean(),
  /** 0 = first; for one value the first matching rule wins. */
  position: z.number().int().nonnegative(),
  expiresAt: TimestampSchema.nullable(),
  /** Past `expiresAt`: matches nothing, like a disabled rule. */
  expired: z.boolean(),
  definition: RuleDefinitionSchema,
  affected: RuleAffectedSchema,
  createdBy: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const RuleListResponseSchema = z.object({ items: z.array(RuleSchema) });

export const CreateRuleBodySchema = z.object({
  name: RuleNameSchema,
  note: AssetNoteSchema.optional(),
  enabled: z.boolean().optional(),
  expiresAt: TimestampSchema.nullable().optional(),
  definition: RuleDefinitionSchema,
});

export const UpdateRuleBodySchema = z
  .object({
    name: RuleNameSchema.optional(),
    note: AssetNoteSchema.optional(),
    enabled: z.boolean().optional(),
    expiresAt: TimestampSchema.nullable().optional(),
    definition: RuleDefinitionSchema.optional(),
    /** Moves the rule to this place in the order (0 = first). */
    position: z.number().int().nonnegative().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

/** How many changed targets a preview lists. */
export const RULE_PREVIEW_SAMPLES = 20;

export const RulePreviewBodySchema = z.object({
  definition: RuleDefinitionSchema,
  /** The rule being edited: its place in the order, and its own values count as its own. */
  ruleId: z.uuid().optional(),
});

const RulePreviewTriageSchema = z.union([TriageStatusSchema, VulnerabilityTriageStatusSchema]);

/** One target the rule would change (or one change row it would re-rate). */
export const RulePreviewItemSchema = z.object({
  hostId: z.uuid(),
  ip: z.ipv4(),
  serviceId: z.uuid().nullable(),
  port: z.number().int().nullable(),
  /** Vulnerability rules: the vulnerability. */
  vulnerabilityId: z.string().nullable(),
  /** Change rules: the change row. */
  change: ScanChangeSchema.nullable(),
  field: FieldChangeKindSchema.nullable(),
  key: z.string().nullable(),
  /** The triage now and what the rule sets; `null` when the rule sets no triage here. */
  triage: z
    .object({ before: RulePreviewTriageSchema, after: RulePreviewTriageSchema })
    .nullable(),
  /** The tag the rule adds. */
  tag: z.string().nullable(),
  /** Change rules: the built-in priority and what the rule makes of it. */
  priority: z
    .object({
      before: ChangePrioritySchema,
      after: z.union([ChangePrioritySchema, z.literal("muted")]),
    })
    .nullable(),
});

export const RulePreviewResponseSchema = z.object({
  /** Targets (or change rows) the rule matches now. */
  matched: CountSchema,
  /** Of those, how many it would change. */
  changes: CountSchema,
  /** Already as the rule says. */
  unchanged: CountSchema,
  /** Set by a user, or by a rule earlier in the order: the rule leaves them as they are. */
  skipped: CountSchema,
  samples: z.array(RulePreviewItemSchema).max(RULE_PREVIEW_SAMPLES),
  /** The scan the preview read: the newest with results (`unchanged`, `change_priority`). */
  scan: z.object({ id: z.uuid(), startedAt: TimestampSchema.nullable() }).nullable(),
});

export type RuleKind = z.infer<typeof RuleKindSchema>;
export type RuleTarget = z.infer<typeof RuleTargetSchema>;
export type RuleScope = z.infer<typeof RuleScopeSchema>;
export type VulnerabilityCondition = z.infer<typeof VulnerabilityConditionSchema>;
export type ServiceCondition = z.infer<typeof ServiceConditionSchema>;
export type ServiceAction = z.infer<typeof ServiceActionSchema>;
export type UnchangedCondition = z.infer<typeof UnchangedConditionSchema>;
export type ChangeRowKind = z.infer<typeof ChangeRowKindSchema>;
export type ChangePriorityCondition = z.infer<typeof ChangePriorityConditionSchema>;
export type ChangePriorityAction = z.infer<typeof ChangePriorityActionSchema>;
export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;
export type RuleAffected = z.infer<typeof RuleAffectedSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type RuleListResponse = z.infer<typeof RuleListResponseSchema>;
export type CreateRuleBody = z.infer<typeof CreateRuleBodySchema>;
export type UpdateRuleBody = z.infer<typeof UpdateRuleBodySchema>;
export type RulePreviewBody = z.infer<typeof RulePreviewBodySchema>;
export type RulePreviewItem = z.infer<typeof RulePreviewItemSchema>;
export type RulePreviewResponse = z.infer<typeof RulePreviewResponseSchema>;
