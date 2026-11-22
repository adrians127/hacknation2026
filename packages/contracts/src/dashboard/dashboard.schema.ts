import { z } from "zod";

import { RuleRefSchema } from "../rules/rule-ref.schema";
import { ChangePrioritySchema, ChangeReasonSchema } from "../scans/scan-changes.schema";
import {
  FieldChangeSchema,
  HostLifecycleSchema,
  ScanChangeCountsSchema,
  ScanChangeSchema,
  ScanDetectionCountSchema,
} from "../scans/scan-results.schema";

/** How many changes the dashboard lists, most important first. */
export const DASHBOARD_TOP_CHANGES = 20;
/** How many detection signatures the dashboard lists. */
export const DASHBOARD_TOP_DETECTIONS = 8;

const CountSchema = z.number().int().nonnegative();
const ScanRefSchema = z.object({ id: z.uuid(), startedAt: z.iso.datetime().nullable() });

/**
 * One change worth a look: a host that is new, gone or unknown (`port: null`, with the ports
 * that opened or closed), or one changed service with what changed in it.
 */
export const DashboardChangeSchema = z.object({
  hostId: z.uuid(),
  ip: z.ipv4(),
  hostnames: z.array(z.string()),
  /** `null` for a change of the whole host. */
  port: z.number().int().nullable(),
  change: ScanChangeSchema,
  priority: ChangePrioritySchema,
  /** Why, most important first. */
  reasons: z.array(ChangeReasonSchema),
  /** The rule that rated the row the item takes its priority from. */
  rule: RuleRefSchema.nullable(),
  /** The ports a new or gone host opened or closed. */
  ports: z.array(z.number().int()),
  /** What changed in a changed service (or a changed host's names). */
  fields: z.array(FieldChangeSchema),
  lifecycle: HostLifecycleSchema,
});

export const DashboardResponseSchema = z.object({
  /** The newest scan with results; `null` before the first one. */
  scan: ScanRefSchema.nullable(),
  /** What it is compared with; `null` for the first scan. */
  baseScan: ScanRefSchema.nullable(),
  hosts: z.object({
    /** Up in the newest scan. */
    up: CountSchema,
    /** Every known host's lifecycle as of the newest scan. */
    unstable: CountSchema,
    inactive: CountSchema,
  }),
  openPorts: CountSchema,
  changes: ScanChangeCountsSchema.nullable(),
  /** The grouped changes by priority, all of them (not only the listed ones). */
  priorities: z.object({ high: CountSchema, medium: CountSchema, low: CountSchema }),
  /** Changes rules muted: left out of the groups above. */
  muted: CountSchema,
  topChanges: z.array(DashboardChangeSchema).max(DASHBOARD_TOP_CHANGES),
  /** Detection signatures with a severity that matched in the newest scan. */
  detections: z.object({
    /** Hosts per the most severe signature that matched them. */
    hosts: z.object({ high: CountSchema, medium: CountSchema, low: CountSchema, info: CountSchema }),
    /** Most severe first, then most hosts. */
    top: z.array(ScanDetectionCountSchema).max(DASHBOARD_TOP_DETECTIONS),
  }),
});

export type DashboardChange = z.infer<typeof DashboardChangeSchema>;
export type DashboardResponse = z.infer<typeof DashboardResponseSchema>;
