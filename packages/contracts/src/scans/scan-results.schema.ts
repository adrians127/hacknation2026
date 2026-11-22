import { z } from "zod";

import { TagSchema } from "../common/common.schema";
import { ServiceRemediationSchema } from "../defectdojo/defectdojo.schema";
import { HOST_SELECTORS_MAX, HostSelectorSchema } from "../hosts/host-selectors";
import {
  HttpSummarySchema,
  ServiceIdentitySchema,
  TriageStatusSchema,
} from "../hosts/hosts.schema";
import {
  HostStatusSchema,
  HttpEndpointSchema,
  OpenPortSchema,
  PortTlsSchema,
} from "../workers/worker-result.schema";
import {
  ServiceVulnerabilitySchema,
  VulnerabilityFilterSchema,
  VulnerabilitySummarySchema,
} from "../vulnerabilities/vulnerabilities.schema";
import { ScanSchema, type ScanJobStatus } from "./scans.schema";

// Separate from scans.schema.ts: worker-result.schema imports that file, so it cannot import back.

/**
 * A host or service compared with the base scan (by default the previous scan with results):
 * - `new`: up now and answered `down` in the base scan (a port: open now, not before);
 * - `gone`: answered `down` now, was up before (a port: open before, not now);
 * - `changed`: a service's fingerprint differs, or a host has a new, gone or changed service;
 * - `unknown`: one side has no conclusive answer: up before but `timeout`, `cancelled` or
 *   `failed` now, or up now but the base scan got no answer or did not cover the address.
 *   Only conclusive answers count (docs/worker-result-format.md).
 */
export const ScanChangeSchema = z.enum(["new", "gone", "changed", "unchanged", "unknown"]);

/** `any` = new, gone or changed. */
export const ScanChangeFilterSchema = z.enum(["any", "new", "gone", "changed", "unknown"]);

const CountSchema = z.number().int().nonnegative();

export const ScanChangeCountsSchema = z.object({
  hosts: z.object({ new: CountSchema, gone: CountSchema, changed: CountSchema, unknown: CountSchema }),
  services: z.object({ new: CountSchema, gone: CountSchema, changed: CountSchema }),
});

/** Addresses with a conclusive answer (`up` or `down`) in both scans, or in only one of them. */
export const ScanCoverageSchema = z.object({
  both: CountSchema,
  onlyBase: CountSchema,
  onlyCurrent: CountSchema,
});

/** Consecutive `down` answers after which a host counts as inactive. */
export const INACTIVE_AFTER_MISSES = 3;
/** How many of the address's latest conclusive answers (`up`/`down`) the lifecycle looks at. */
export const LIFECYCLE_WINDOW = 10;
/** Up/down switches within the window that make a host unstable. */
export const UNSTABLE_MIN_FLIPS = 2;

/**
 * A host's lifecycle as of the viewed scan, from its latest conclusive answers (PDF: "after how
 * long without an answer should a host be reported inactive?"). `timeout`, `cancelled` and
 * `failed` say nothing:
 * - `inactive`: the last `INACTIVE_AFTER_MISSES` answers were `down`;
 * - `unstable`: switched between up and down at least `UNSTABLE_MIN_FLIPS` times;
 * - `missing`: the last answer was `down`, fewer times in a row than `INACTIVE_AFTER_MISSES`;
 * - `active`: otherwise.
 */
export const HostLifecycleStateSchema = z.enum(["active", "unstable", "missing", "inactive"]);

export const HostLifecycleSchema = z.object({
  state: HostLifecycleStateSchema,
  /** Consecutive `down` answers up to the viewed scan. */
  misses: CountSchema,
  /** Up/down switches within the window. */
  flips: CountSchema,
});

/** Picks the scan to compare with; it must be older. Omitted: the previous scan with results. */
export const ScanCompareQuerySchema = z.object({ base: z.uuid().optional() });

export const ScanDetailSchema = ScanSchema.extend({
  ports: z.string(),
  maxRate: z.number().int(),
  batchSize: z.number().int(),
  jobs: z.object({
    queued: CountSchema,
    leased: CountSchema,
    completed: CountSchema,
    failed: CountSchema,
    stopped: CountSchema,
  }) satisfies z.ZodType<Record<ScanJobStatus, number>>,
  /** The scan this one is compared with; `null` for the first scan. */
  baseScan: z.object({ id: z.uuid(), startedAt: z.iso.datetime().nullable() }).nullable(),
  /** `null` without a base scan. */
  changes: ScanChangeCountsSchema.nullable(),
  /** `null` without a base scan. */
  coverage: ScanCoverageSchema.nullable(),
});

/**
 * One field that differs between the base scan's and this scan's observation of a port (or, for
 * `host.hostname`, of the host). The compared fields are the ones the port fingerprint covers.
 */
export const FieldChangeKindSchema = z.enum([
  "service.name",
  "service.product",
  "service.version",
  "service.extraInfo",
  "service.cpe",
  "ssh.hostKey",
  "http.endpoint",
  "http.status",
  "http.title",
  "http.redirect",
  "http.header",
  "http.securityHeader",
  "http.cookie",
  "http.cookieFlags",
  "tls.cert",
  "tls.issuer",
  "tls.expiry",
  "tls.selfSigned",
  "tls.version",
  "tls.cipher",
  "tls.endpoint",
  "http.favicon",
  "http.probe",
  "host.hostname",
]);

export const FieldChangeSchema = z.object({
  field: FieldChangeKindSchema,
  /** The HTTP endpoint the change is on (`vhost: null` = requested by bare IP). */
  endpoint: HttpEndpointSchema.pick({ scheme: true, vhost: true }).nullable(),
  /** Header name, cookie name or probe path. */
  key: z.string().nullable(),
  /** `null`: absent on that side (a header, cookie, endpoint or probe that appeared or went). */
  before: z.string().nullable(),
  after: z.string().nullable(),
});

/** How one scan saw a port, from plaintext columns only. */
export const ServiceSnapshotSchema = z.object({
  observed: ServiceIdentitySchema,
  http: z.array(HttpSummarySchema),
});

export const ScanServiceSchema = z.object({
  /** The Service asset: edits go to `PATCH /hosts/{hostId}/services/{id}`. */
  id: z.uuid(),
  protocol: z.literal("tcp"),
  port: z.number().int(),
  /** `null` without a base scan. */
  change: ScanChangeSchema.nullable(),
  /** As this scan identified it (as the base scan did for a `gone` service). */
  observed: ServiceIdentitySchema,
  overrides: ServiceIdentitySchema,
  http: z.array(HttpSummarySchema),
  /**
   * The base scan's observation of the port; `null` when it was not open there or there is no
   * base scan. This scan observed the port when the host is `up` and the service is not `gone`.
   */
  before: ServiceSnapshotSchema.nullable(),
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  note: z.string(),
  /** Of the Service asset as its newest observation describes it, whatever scan is viewed. */
  vulnerabilities: VulnerabilitySummarySchema,
  /** From the last DefectDojo sync; `null` when no DefectDojo finding gives a date. */
  remediation: ServiceRemediationSchema.nullable(),
});

export const ScanHostSchema = z.object({
  /** The Host asset: edits go to `PATCH /hosts/{id}`. */
  id: z.uuid(),
  ip: z.ipv4(),
  /** What this scan got from the address. */
  status: HostStatusSchema,
  /** What the base scan got from the address; `null` when it did not cover it or there is none. */
  baseStatus: HostStatusSchema.nullable(),
  observedAt: z.iso.datetime().nullable(),
  latencyMs: z.number().int().nullable(),
  hostnames: z.array(z.string()),
  change: ScanChangeSchema.nullable(),
  /** As of this scan. */
  lifecycle: HostLifecycleSchema,
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  note: z.string(),
  /** Distinct vulnerabilities across the host's services. */
  vulnerabilities: VulnerabilitySummarySchema,
  services: z.array(ScanServiceSchema),
});

export const SCAN_HOSTS_PAGE_SIZE_MAX = 200;

/** Query strings arrive as text: the backend re-parses with this schema to get numbers. */
export const ScanHostListQuerySchema = ScanCompareQuerySchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(SCAN_HOSTS_PAGE_SIZE_MAX).default(50),
  /** IP prefix, hostname, tag, port, service name/product or HTTP page title. */
  q: z.string().max(200).optional(),
  /** Matches the host's triage status or any of its services'. */
  triage: TriageStatusSchema.optional(),
  change: ScanChangeFilterSchema.optional(),
  /** Hosts with a confirmed vulnerability (any, critical, high or above, in CISA KEV). */
  vulnerability: VulnerabilityFilterSchema.optional(),
});

export const ScanHostListResponseSchema = z.object({
  items: z.array(ScanHostSchema),
  total: CountSchema,
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

/** How one scan saw a port, decrypted. */
export const ServiceObservationSchema = z.object({
  observed: ServiceIdentitySchema,
  reason: z.string().nullable(),
  extraInfo: z.string().nullable(),
  cpe: z.array(z.string()),
  method: z.string().nullable(),
  confidence: z.number().int().nullable(),
  identity: OpenPortSchema.shape.identity,
  banner: z.string().nullable(),
  scripts: OpenPortSchema.shape.scripts,
  /** Full endpoints, decrypted: headers, cookies (hashed values only), TLS certificate, probes. */
  http: z.array(HttpEndpointSchema),
  tls: z.array(PortTlsSchema),
});

export const ScanServiceDetailSchema = ScanServiceSchema.extend(ServiceObservationSchema.shape).extend({
  /** The base scan's observation of the port, decrypted; `null` when it was not open there. */
  before: ServiceObservationSchema.nullable(),
  /** What differs from `before`; empty unless the service is `changed`. */
  fieldChanges: z.array(FieldChangeSchema),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  /** Active matches first, then the ones retracted in the last 30 days. */
  vulnerabilityMatches: z.array(ServiceVulnerabilitySchema),
});

export const HostHistoryEntrySchema = z.object({
  scanId: z.uuid(),
  scannedAt: z.iso.datetime(),
  status: HostStatusSchema,
  observedAt: z.iso.datetime().nullable(),
  latencyMs: z.number().int().nullable(),
  openPorts: CountSchema,
});

export const HOST_HISTORY_LIMIT = 10;

export const ScanHostDetailSchema = ScanHostSchema.extend({
  /** Host-level differences from the base scan (`host.hostname`), when it was up in both. */
  fieldChanges: z.array(FieldChangeSchema),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  services: z.array(ScanServiceDetailSchema),
  /** Every scan of this address, newest first, at most `HOST_HISTORY_LIMIT`. */
  history: z.array(HostHistoryEntrySchema),
});

export const ScanHostParamsSchema = z.object({ id: z.uuid(), hostId: z.uuid() });

export const ScanHostTagActionSchema = z.enum(["add", "remove"]);

/** Hosts of the scan list (gone and unknown included) whose address falls in any selector. */
export const TagScanHostsBodySchema = z.object({
  action: ScanHostTagActionSchema,
  tag: TagSchema,
  selectors: z.array(HostSelectorSchema).min(1).max(HOST_SELECTORS_MAX),
});

export const TagScanHostsResponseSchema = z.object({
  /** Hosts of the scan inside the selectors. */
  matched: CountSchema,
  /** Got the tag (`add`) or lost it (`remove`). */
  changed: CountSchema,
  /** Already had the tag (`add`) or never had it (`remove`). */
  unchanged: CountSchema,
  /** `add` only: skipped because the host already has `MAX_TAGS` tags. */
  limitReached: CountSchema,
});

export type ScanChange = z.infer<typeof ScanChangeSchema>;
export type ScanChangeFilter = z.infer<typeof ScanChangeFilterSchema>;
export type ScanChangeCounts = z.infer<typeof ScanChangeCountsSchema>;
export type ScanCoverage = z.infer<typeof ScanCoverageSchema>;
export type HostLifecycleState = z.infer<typeof HostLifecycleStateSchema>;
export type HostLifecycle = z.infer<typeof HostLifecycleSchema>;
export type ScanCompareQuery = z.infer<typeof ScanCompareQuerySchema>;
export type ServiceSnapshot = z.infer<typeof ServiceSnapshotSchema>;
export type FieldChangeKind = z.infer<typeof FieldChangeKindSchema>;
export type FieldChange = z.infer<typeof FieldChangeSchema>;
export type ServiceObservation = z.infer<typeof ServiceObservationSchema>;
export type ScanDetail = z.infer<typeof ScanDetailSchema>;
export type ScanService = z.infer<typeof ScanServiceSchema>;
export type ScanHost = z.infer<typeof ScanHostSchema>;
export type ScanHostListQuery = z.infer<typeof ScanHostListQuerySchema>;
export type ScanHostListResponse = z.infer<typeof ScanHostListResponseSchema>;
export type ScanServiceDetail = z.infer<typeof ScanServiceDetailSchema>;
export type HostHistoryEntry = z.infer<typeof HostHistoryEntrySchema>;
export type ScanHostDetail = z.infer<typeof ScanHostDetailSchema>;
export type ScanHostParams = z.infer<typeof ScanHostParamsSchema>;
export type ScanHostTagAction = z.infer<typeof ScanHostTagActionSchema>;
export type TagScanHostsBody = z.infer<typeof TagScanHostsBodySchema>;
export type TagScanHostsResponse = z.infer<typeof TagScanHostsResponseSchema>;
