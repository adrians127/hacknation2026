import { z } from "zod";

import { ServiceRemediationSchema } from "../defectdojo/defectdojo.schema";
import { ServiceIdentitySchema, TriageStatusSchema } from "../hosts/hosts.schema";
import {
  ScanChangeCountsSchema,
  ScanChangeSchema,
  ScanDetailSchema,
} from "../scans/scan-results.schema";
import { ScanStatusSchema } from "../scans/scans.schema";
import { SignatureRefSchema } from "../signatures/detection.schema";
import { HostStatusSchema } from "../workers/worker-result.schema";

// Read-only reports built from stored scan results (modules/reports in the backend).

const CountSchema = z.number().int().nonnegative();
const TriageCountsSchema = z.object({
  unreviewed: CountSchema,
  reviewed: CountSchema,
  important: CountSchema,
  false_positive: CountSchema,
});

export const ReportScanSchema = z.object({
  id: z.uuid(),
  status: ScanStatusSchema,
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});

export const ReportScanParamsSchema = z.object({ id: z.uuid() });

// --- Findings: what is worth an analyst's attention (safe, passive rules) -----------------

export const FindingSeveritySchema = z.enum(["high", "medium", "low", "info"]);

/** Every rule works on data the scan already collected; none sends anything to the host. */
export const FindingRuleSchema = z.enum([
  "database-exposed",
  "debug-or-staging",
  "tls-expired",
  "admin-panel",
  "cleartext-protocol",
  "directory-listing",
  "tls-expiring",
  "tls-weak",
  "outdated-software",
  "remote-access",
  "tls-self-signed",
  "cookie-insecure",
  "cors-wildcard",
  "default-page",
  "missing-security-headers",
  "version-disclosure",
  /** A detection signature with a severity whose category has no rule above (one finding each). */
  "signature",
]);

export const FindingSchema = z.object({
  rule: FindingRuleSchema,
  severity: FindingSeveritySchema,
  hostId: z.uuid(),
  serviceId: z.uuid(),
  ip: z.ipv4(),
  port: z.number().int(),
  /** What matched, e.g. a header, a title or a certificate date. Not translated. */
  evidence: z.string(),
  /** The detection signatures (`/signatures`) that raised it; empty for the built-in analyses. */
  signatures: z.array(SignatureRefSchema),
});

export const SeverityCountsSchema = z.object({
  high: CountSchema,
  medium: CountSchema,
  low: CountSchema,
  info: CountSchema,
});

export const PrioritizedHostSchema = z.object({
  hostId: z.uuid(),
  ip: z.ipv4(),
  hostnames: z.array(z.string()),
  /**
   * Analytical priority: severity weights summed, plus a bonus for services new since the base
   * scan and for hosts triaged `important`. False positives are left out.
   */
  score: z.number().nonnegative(),
  change: ScanChangeSchema.nullable(),
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  findings: z.array(FindingSchema),
});

export const FindingsReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  scan: ReportScanSchema,
  counts: SeverityCountsSchema,
  byRule: z.array(z.object({ rule: FindingRuleSchema, severity: FindingSeveritySchema, count: CountSchema })),
  /** Highest score first. */
  hosts: z.array(PrioritizedHostSchema),
});

// --- Technologies and CMSs --------------------------------------------------------------

export const TechnologyCategorySchema = z.enum([
  "cms",
  "web-server",
  "language",
  "framework",
  "application",
  "device",
  "service",
]);

/** Where a detection came from; more independent sources give a higher confidence. */
export const TechnologySourceSchema = z.enum([
  "service-detection",
  "header",
  "meta-generator",
  "body",
  "cookie",
  "title",
  "probe",
  "favicon",
  "banner",
]);

export const TechnologyConfidenceSchema = z.enum(["high", "medium", "low"]);

export const TechnologyInstanceSchema = z.object({
  hostId: z.uuid(),
  serviceId: z.uuid(),
  ip: z.ipv4(),
  port: z.number().int(),
  version: z.string().nullable(),
  sources: z.array(TechnologySourceSchema),
  confidence: TechnologyConfidenceSchema,
  /** The detection signatures (`/signatures`) that recognised it; empty when only nmap or headers did. */
  signatures: z.array(SignatureRefSchema),
});

export const TechnologySchema = z.object({
  name: z.string(),
  category: TechnologyCategorySchema,
  hosts: CountSchema,
  services: CountSchema,
  /** Most services first; `null` = version unknown. */
  versions: z.array(z.object({ version: z.string().nullable(), services: CountSchema })),
  instances: z.array(TechnologyInstanceSchema),
});

/** Services that run the same software, or web pages that look the same (title + favicon). */
export const ServiceGroupSchema = z.object({
  kind: z.enum(["software", "web-page"]),
  label: z.string(),
  services: CountSchema,
  members: z.array(z.object({ hostId: z.uuid(), serviceId: z.uuid(), ip: z.ipv4(), port: z.number().int() })),
});

export const TechnologiesReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  scan: ReportScanSchema,
  /** Most hosts first. */
  technologies: z.array(TechnologySchema),
  /** Groups of at least two services, largest first. */
  groups: z.array(ServiceGroupSchema),
});

// --- Port exposure ----------------------------------------------------------------------

export const ExposureReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  scan: ReportScanSchema,
  totals: z.object({ hostsUp: CountSchema, openPorts: CountSchema, distinctPorts: CountSchema }),
  /** Most hosts first. */
  ports: z.array(
    z.object({
      port: z.number().int(),
      protocol: z.literal("tcp"),
      hosts: CountSchema,
      /** Hosts where the port is new since the base scan. */
      newHosts: CountSchema,
      services: z.array(z.object({ name: z.string(), count: CountSchema })),
    }),
  ),
  /** /24 networks with live hosts, in address order. */
  subnets: z.array(
    z.object({
      cidr: z.cidrv4(),
      hostsUp: CountSchema,
      openPorts: CountSchema,
      topPorts: z.array(z.number().int()),
    }),
  ),
});

// --- Triage progress --------------------------------------------------------------------

export const TriageItemSchema = z.object({
  hostId: z.uuid(),
  serviceId: z.uuid(),
  ip: z.ipv4(),
  port: z.number().int(),
  identity: ServiceIdentitySchema,
  change: ScanChangeSchema.nullable(),
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  remediation: ServiceRemediationSchema.nullable(),
});

export const TriageReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  scan: ReportScanSchema,
  hosts: TriageCountsSchema,
  services: TriageCountsSchema,
  /** Share of the scan's services with a verdict other than `unreviewed`, 0–1. */
  progress: z.number().min(0).max(1),
  /** New since the base scan and not reviewed yet: what to look at first. */
  newUnreviewed: z.array(TriageItemSchema),
  important: z.array(TriageItemSchema),
  /** DefectDojo dates (`POST /defectdojo/sync`). */
  remediation: z.object({
    overdue: z.array(TriageItemSchema),
    dueSoon: z.array(TriageItemSchema),
    riskAcceptanceExpiring: z.array(TriageItemSchema),
  }),
});

// --- Tags -------------------------------------------------------------------------------

export const TagsReportQuerySchema = z.object({ tag: z.string().min(1).max(50).optional() });

export const TagReportHostSchema = z.object({
  hostId: z.uuid(),
  ip: z.ipv4(),
  hostnames: z.array(z.string()),
  status: HostStatusSchema,
  change: ScanChangeSchema.nullable(),
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  findings: SeverityCountsSchema,
  services: z.array(
    z.object({
      serviceId: z.uuid(),
      port: z.number().int(),
      identity: ServiceIdentitySchema,
      change: ScanChangeSchema.nullable(),
      triage: TriageStatusSchema,
      tags: z.array(z.string()),
    }),
  ),
});

export const TagsReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  scan: ReportScanSchema,
  /** Every tag on a host or service of this scan, most hosts first. */
  tags: z.array(
    z.object({
      tag: z.string(),
      hosts: CountSchema,
      services: CountSchema,
      changedHosts: CountSchema,
      findings: SeverityCountsSchema,
    }),
  ),
  /** Hosts carrying `tag` (on the host or one of its services); `null` without `tag`. */
  selected: z
    .object({ tag: z.string(), changes: ScanChangeCountsSchema.nullable(), hosts: z.array(TagReportHostSchema) })
    .nullable(),
});

// --- Changes between any two scans ------------------------------------------------------

export const DiffReportQuerySchema = z.object({ from: z.uuid(), to: z.uuid() });

export const ServiceSnapshotSchema = z.object({
  identity: ServiceIdentitySchema,
  /** `server`, `x-powered-by` and similar headers, as `name: value`. */
  software: z.array(z.string()),
  http: z.array(
    z.object({
      url: z.string(),
      statusCode: z.number().int().nullable(),
      title: z.string().nullable(),
      finalUrl: z.string(),
    }),
  ),
  certSha256: z.string().nullable(),
  certNotAfter: z.iso.datetime().nullable(),
});

export const DiffFieldSchema = z.enum([
  "name",
  "product",
  "version",
  "software",
  "http-status",
  "http-title",
  "redirect",
  "certificate",
  "other",
]);

export const DiffReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  from: ReportScanSchema,
  to: ReportScanSchema,
  counts: ScanChangeCountsSchema,
  /** Only hosts that are new, gone, changed or unknown, in address order. */
  hosts: z.array(
    z.object({
      hostId: z.uuid(),
      ip: z.ipv4(),
      hostnames: z.array(z.string()),
      change: ScanChangeSchema,
      status: HostStatusSchema,
      triage: TriageStatusSchema,
      tags: z.array(z.string()),
      /** Services that are not unchanged. */
      services: z.array(
        z.object({
          serviceId: z.uuid(),
          port: z.number().int(),
          protocol: z.literal("tcp"),
          change: ScanChangeSchema,
          before: ServiceSnapshotSchema.nullable(),
          after: ServiceSnapshotSchema.nullable(),
          /** What differs between `before` and `after` (`other`: something only the fingerprint shows). */
          fields: z.array(DiffFieldSchema),
        }),
      ),
    }),
  ),
});

// --- One IP address over time -----------------------------------------------------------

export const IpReportParamsSchema = z.object({ ip: z.ipv4() });

export const IpReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  ip: z.ipv4(),
  /** `null` while the address has never been up. */
  host: z
    .object({
      id: z.uuid(),
      hostnames: z.array(z.string()),
      firstSeenAt: z.iso.datetime(),
      lastSeenAt: z.iso.datetime(),
      triage: TriageStatusSchema,
      tags: z.array(z.string()),
      note: z.string(),
    })
    .nullable(),
  stats: z.object({
    scans: CountSchema,
    up: CountSchema,
    /** Up answers among conclusive (`up`/`down`) ones, 0–1; `null` without any. */
    availability: z.number().min(0).max(1).nullable(),
    /** Changes between up and not up from one scan to the next. */
    transitions: CountSchema,
    lastStatus: HostStatusSchema,
  }),
  /** Every scan that covered the address, oldest first. */
  timeline: z.array(
    z.object({
      scanId: z.uuid(),
      scannedAt: z.iso.datetime(),
      status: HostStatusSchema,
      latencyMs: z.number().int().nullable(),
      openPorts: z.array(z.number().int()),
      /** Against the previous entry with status `up`. */
      opened: z.array(z.number().int()),
      closed: z.array(z.number().int()),
      changed: z.array(z.number().int()),
    }),
  ),
  services: z.array(
    z.object({
      serviceId: z.uuid(),
      port: z.number().int(),
      protocol: z.literal("tcp"),
      /** Open at the latest conclusive answer (`up` or `down`; a timeout says nothing). */
      isOpen: z.boolean(),
      firstSeenAt: z.iso.datetime(),
      lastSeenAt: z.iso.datetime(),
      seenInScans: CountSchema,
      triage: TriageStatusSchema,
      tags: z.array(z.string()),
      note: z.string(),
      remediation: ServiceRemediationSchema.nullable(),
      /** Each distinct state the service had, oldest first (consecutive scans collapsed). */
      states: z.array(
        z.object({
          firstScanAt: z.iso.datetime(),
          lastScanAt: z.iso.datetime(),
          scans: CountSchema,
          snapshot: ServiceSnapshotSchema,
        }),
      ),
    }),
  ),
  /** From the latest scan that answered `up`. */
  findings: z.array(FindingSchema),
  technologies: z.array(
    z.object({ name: z.string(), category: TechnologyCategorySchema, version: z.string().nullable(), port: z.number().int() }),
  ),
});

// --- Unstable hosts across recent scans ---------------------------------------------------

export const STABILITY_WINDOW_MAX = 30;

export const StabilityReportQuerySchema = z.object({
  /** The newest scan of the window; default: the latest scan with results. */
  scanId: z.uuid().optional(),
  /** How many scans with results, ending at `scanId`. */
  window: z.coerce.number().int().min(2).max(STABILITY_WINDOW_MAX).default(10),
  /** Consecutive `down` answers after which a host counts as inactive. */
  inactiveAfter: z.coerce.number().int().min(1).max(STABILITY_WINDOW_MAX).default(3),
});

export const StabilityClassSchema = z.enum([
  /** Up and not up more than once in the window. */
  "flapping",
  /** Was up, the latest scans got no answer at all (timeout, cancelled, failed). */
  "unresponsive",
  /** `down` in the latest `inactiveAfter` scans: report it as inactive. */
  "inactive",
  /** `down` lately, but fewer than `inactiveAfter` times in a row. */
  "going-quiet",
  /** Up throughout, but its open ports came and went. */
  "unstable-ports",
  /** Came back up after not answering. */
  "returned",
]);

export const StabilityReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  /** Oldest first: the columns of each host's `history`. */
  scans: z.array(ReportScanSchema),
  inactiveAfter: z.number().int(),
  counts: z.object({
    flapping: CountSchema,
    unresponsive: CountSchema,
    inactive: CountSchema,
    "going-quiet": CountSchema,
    "unstable-ports": CountSchema,
    returned: CountSchema,
  }) satisfies z.ZodType<Record<z.infer<typeof StabilityClassSchema>, number>>,
  /** Most unstable first. */
  hosts: z.array(
    z.object({
      hostId: z.uuid(),
      ip: z.ipv4(),
      hostnames: z.array(z.string()),
      class: StabilityClassSchema,
      /** One per scan of the window; `null` when the scan did not cover the address. */
      history: z.array(HostStatusSchema.nullable()),
      up: CountSchema,
      transitions: CountSchema,
      /** Scans since the host was last up (0 = up in the newest scan). */
      sinceLastUp: CountSchema,
      /** Ports that opened or closed between two `up` answers. */
      unstablePorts: z.array(z.number().int()),
      /** Worth a repeat measurement before drawing conclusions. */
      recheck: z.boolean(),
    }),
  ),
});

// --- Availability by time of day ----------------------------------------------------------

export const DayPeriodSchema = z.enum(["night", "morning", "afternoon", "evening"]);

export const TimeOfDayReportQuerySchema = z.object({
  /** How many of the latest scans with results to compare. */
  scans: z.coerce.number().int().min(2).max(100).default(30),
  /** The viewer's `-Date.getTimezoneOffset()`: periods follow local time. */
  utcOffsetMinutes: z.coerce.number().int().min(-840).max(840).default(0),
});

export const TimeOfDayReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  utcOffsetMinutes: z.number().int(),
  /** night 0–6, morning 6–12, afternoon 12–18, evening 18–24 (local time). */
  periods: z.array(z.object({ period: DayPeriodSchema, scans: CountSchema })),
  /** At least two periods have scans; otherwise nothing can be compared. */
  comparable: z.boolean(),
  /** Hosts whose availability or open ports depend on the period. */
  hosts: z.array(
    z.object({
      hostId: z.uuid(),
      ip: z.ipv4(),
      hostnames: z.array(z.string()),
      periods: z.array(
        z.object({
          period: DayPeriodSchema,
          observed: CountSchema,
          up: CountSchema,
          /** Ports open in at least one scan of this period. */
          ports: z.array(z.number().int()),
        }),
      ),
      /** Periods where the host was up in most scans, and those where it mostly was not. */
      upIn: z.array(DayPeriodSchema),
      downIn: z.array(DayPeriodSchema),
      /** Ports open in some periods only. */
      periodPorts: z.array(z.number().int()),
    }),
  ),
});

// --- Post-scan summary -------------------------------------------------------------------

export const ScanSummaryReportSchema = z.object({
  generatedAt: z.iso.datetime(),
  scan: ScanDetailSchema,
  execution: z.object({
    results: CountSchema,
    partialResults: CountSchema,
    failedResults: CountSchema,
    stopReasons: z.array(z.object({ reason: z.string(), count: CountSchema })),
    workers: z.array(z.object({ id: z.string(), version: z.string(), nmapVersion: z.string().nullable() })),
    /** Summed over job results. */
    phasesMs: z.object({
      hostDiscovery: CountSchema,
      portScan: CountSchema,
      serviceDetection: CountSchema,
      http: CountSchema,
    }),
    httpEndpoints: CountSchema,
    httpRequests: CountSchema,
  }),
  findings: SeverityCountsSchema,
  /** The highest-priority hosts (at most 10). */
  topHosts: z.array(PrioritizedHostSchema),
  topPorts: z.array(z.object({ port: z.number().int(), hosts: CountSchema })),
  topTechnologies: z.array(
    z.object({ name: z.string(), category: TechnologyCategorySchema, hosts: CountSchema }),
  ),
  triage: z.object({ hosts: TriageCountsSchema, services: TriageCountsSchema }),
  /** Against the base scan; `null` for the first scan. At most 25 of each. */
  changes: z
    .object({
      newHosts: z.array(z.object({ hostId: z.uuid(), ip: z.ipv4(), hostnames: z.array(z.string()), ports: z.array(z.number().int()) })),
      goneHosts: z.array(z.object({ hostId: z.uuid(), ip: z.ipv4(), hostnames: z.array(z.string()), ports: z.array(z.number().int()) })),
      changedServices: z.array(
        z.object({ hostId: z.uuid(), ip: z.ipv4(), port: z.number().int(), change: ScanChangeSchema }),
      ),
    })
    .nullable(),
});

export type ReportScan = z.infer<typeof ReportScanSchema>;
export type ReportScanParams = z.infer<typeof ReportScanParamsSchema>;
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;
export type FindingRule = z.infer<typeof FindingRuleSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type SeverityCounts = z.infer<typeof SeverityCountsSchema>;
export type PrioritizedHost = z.infer<typeof PrioritizedHostSchema>;
export type FindingsReport = z.infer<typeof FindingsReportSchema>;
export type TechnologyCategory = z.infer<typeof TechnologyCategorySchema>;
export type TechnologySource = z.infer<typeof TechnologySourceSchema>;
export type TechnologyConfidence = z.infer<typeof TechnologyConfidenceSchema>;
export type TechnologyInstance = z.infer<typeof TechnologyInstanceSchema>;
export type Technology = z.infer<typeof TechnologySchema>;
export type ServiceGroup = z.infer<typeof ServiceGroupSchema>;
export type TechnologiesReport = z.infer<typeof TechnologiesReportSchema>;
export type ExposureReport = z.infer<typeof ExposureReportSchema>;
export type TriageItem = z.infer<typeof TriageItemSchema>;
export type TriageReport = z.infer<typeof TriageReportSchema>;
export type TagsReportQuery = z.infer<typeof TagsReportQuerySchema>;
export type TagReportHost = z.infer<typeof TagReportHostSchema>;
export type TagsReport = z.infer<typeof TagsReportSchema>;
export type DiffReportQuery = z.infer<typeof DiffReportQuerySchema>;
export type ServiceSnapshot = z.infer<typeof ServiceSnapshotSchema>;
export type DiffField = z.infer<typeof DiffFieldSchema>;
export type DiffReport = z.infer<typeof DiffReportSchema>;
export type IpReportParams = z.infer<typeof IpReportParamsSchema>;
export type IpReport = z.infer<typeof IpReportSchema>;
export type StabilityReportQuery = z.infer<typeof StabilityReportQuerySchema>;
export type StabilityClass = z.infer<typeof StabilityClassSchema>;
export type StabilityReport = z.infer<typeof StabilityReportSchema>;
export type DayPeriod = z.infer<typeof DayPeriodSchema>;
export type TimeOfDayReportQuery = z.infer<typeof TimeOfDayReportQuerySchema>;
export type TimeOfDayReport = z.infer<typeof TimeOfDayReportSchema>;
export type ScanSummaryReport = z.infer<typeof ScanSummaryReportSchema>;
