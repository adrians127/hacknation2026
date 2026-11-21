import { z } from "zod";

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
import { ScanJobStatusSchema, ScanSchema } from "./scans.schema";

// Separate from scans.schema.ts: worker-result.schema imports that file, so it cannot import back.

/**
 * A host or service compared with the base scan (the previous scan with results):
 * - `new`: open/up now, not before; `gone`: answered `down` now, was up/open before;
 * - `changed`: a service's fingerprint differs, or a host has a new, gone or changed service;
 * - `unknown`: up before, but this scan got no answer (`timeout`, `cancelled`, `failed`).
 *   Unknown is never "gone": only conclusive answers count (docs/worker-result-format.md).
 */
export const ScanChangeSchema = z.enum(["new", "gone", "changed", "unchanged", "unknown"]);

/** `any` = new, gone or changed. */
export const ScanChangeFilterSchema = z.enum(["any", "new", "gone", "changed", "unknown"]);

const CountSchema = z.number().int().nonnegative();

export const ScanChangeCountsSchema = z.object({
  hosts: z.object({ new: CountSchema, gone: CountSchema, changed: CountSchema, unknown: CountSchema }),
  services: z.object({ new: CountSchema, gone: CountSchema, changed: CountSchema }),
});

export const ScanDetailSchema = ScanSchema.extend({
  ports: z.string(),
  maxRate: z.number().int(),
  batchSize: z.number().int(),
  jobs: z.record(ScanJobStatusSchema, CountSchema),
  /** The scan this one is compared with; `null` for the first scan. */
  baseScan: z.object({ id: z.uuid(), startedAt: z.iso.datetime().nullable() }).nullable(),
  /** `null` without a base scan. */
  changes: ScanChangeCountsSchema.nullable(),
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
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  note: z.string(),
});

export const ScanHostSchema = z.object({
  /** The Host asset: edits go to `PATCH /hosts/{id}`. */
  id: z.uuid(),
  ip: z.ipv4(),
  /** What this scan got from the address. */
  status: HostStatusSchema,
  observedAt: z.iso.datetime().nullable(),
  latencyMs: z.number().int().nullable(),
  hostnames: z.array(z.string()),
  change: ScanChangeSchema.nullable(),
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  note: z.string(),
  services: z.array(ScanServiceSchema),
});

export const SCAN_HOSTS_PAGE_SIZE_MAX = 200;

/** Query strings arrive as text: the backend re-parses with this schema to get numbers. */
export const ScanHostListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(SCAN_HOSTS_PAGE_SIZE_MAX).default(50),
  /** IP prefix, hostname, tag, port, service name/product or HTTP page title. */
  q: z.string().max(200).optional(),
  /** Matches the host's triage status or any of its services'. */
  triage: TriageStatusSchema.optional(),
  change: ScanChangeFilterSchema.optional(),
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

export type ScanChange = z.infer<typeof ScanChangeSchema>;
export type ScanChangeFilter = z.infer<typeof ScanChangeFilterSchema>;
export type ScanChangeCounts = z.infer<typeof ScanChangeCountsSchema>;
export type ScanDetail = z.infer<typeof ScanDetailSchema>;
export type ScanService = z.infer<typeof ScanServiceSchema>;
export type ScanHost = z.infer<typeof ScanHostSchema>;
export type ScanHostListQuery = z.infer<typeof ScanHostListQuerySchema>;
export type ScanHostListResponse = z.infer<typeof ScanHostListResponseSchema>;
export type ScanServiceDetail = z.infer<typeof ScanServiceDetailSchema>;
export type HostHistoryEntry = z.infer<typeof HostHistoryEntrySchema>;
export type ScanHostDetail = z.infer<typeof ScanHostDetailSchema>;
export type ScanHostParams = z.infer<typeof ScanHostParamsSchema>;
