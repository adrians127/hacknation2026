import { z } from "zod";

import { TagSchema } from "../common/common.schema";
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

export const ScanServiceDetailSchema = ScanServiceSchema.extend({
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
export type ScanCompareQuery = z.infer<typeof ScanCompareQuerySchema>;
export type ServiceSnapshot = z.infer<typeof ServiceSnapshotSchema>;
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
