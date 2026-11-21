import { z } from "zod";

import { TagsSchema } from "../common/common.schema";
import {
  HostStatusSchema,
  HttpEndpointSchema,
  OpenPortSchema,
} from "../workers/worker-result.schema";

/** The analyst's verdict on a host or service; set by users only, never by a scan. */
export const TriageStatusSchema = z.enum(["unreviewed", "reviewed", "important", "false_positive"]);

export const AssetNoteSchema = z.string().max(2000);

/** What the scanner identified on a port, or what a user corrected it to. */
export const ServiceIdentitySchema = z.object({
  name: z.string().nullable(),
  product: z.string().nullable(),
  version: z.string().nullable(),
});

/** The plaintext part of one HTTP endpoint: enough for a list row without decrypting anything. */
export const HttpSummarySchema = HttpEndpointSchema.pick({
  scheme: true,
  vhost: true,
  url: true,
  finalUrl: true,
  statusCode: true,
  title: true,
});

export const ServiceSummarySchema = z.object({
  id: z.uuid(),
  protocol: z.literal("tcp"),
  port: z.number().int(),
  /** From the newest observation of this port. */
  observed: ServiceIdentitySchema,
  /** User corrections (`null` = not corrected); scans never change them. */
  overrides: ServiceIdentitySchema,
  /** Open in the host's newest scan that answered. */
  seenInLatestScan: z.boolean(),
  http: z.array(HttpSummarySchema),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  note: z.string(),
});

export const HostLastStatusSchema = z.enum(["up", "down"]);

export const HostListItemSchema = z.object({
  id: z.uuid(),
  ip: z.ipv4(),
  /** Names from the newest `up` observation. */
  hostnames: z.array(z.string()),
  /** The newest conclusive answer for this address (`timeout`/`cancelled` are skipped). */
  lastStatus: HostLastStatusSchema.nullable(),
  lastScannedAt: z.iso.datetime().nullable(),
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  note: z.string(),
  services: z.array(ServiceSummarySchema),
});

export const ServiceDetailSchema = ServiceSummarySchema.extend({
  observedAt: z.iso.datetime().nullable(),
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
});

export const HostHistoryEntrySchema = z.object({
  scanId: z.uuid(),
  scannedAt: z.iso.datetime(),
  status: HostStatusSchema,
  observedAt: z.iso.datetime().nullable(),
  latencyMs: z.number().int().nullable(),
  openPorts: z.number().int().nonnegative(),
});

export const HostDetailSchema = HostListItemSchema.extend({
  services: z.array(ServiceDetailSchema),
  /** Newest first, at most `HOST_HISTORY_LIMIT` scans. */
  history: z.array(HostHistoryEntrySchema),
});

export const HOST_HISTORY_LIMIT = 10;
export const HOST_PAGE_SIZE_MAX = 200;

/** Query strings arrive as text: the backend re-parses with this schema to get numbers. */
export const HostListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(HOST_PAGE_SIZE_MAX).default(50),
  /** IP prefix, hostname, tag, port number, or service name/product. */
  q: z.string().max(200).optional(),
  triage: TriageStatusSchema.optional(),
});

export const HostListResponseSchema = z.object({
  items: z.array(HostListItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});

const atLeastOneField = (body: Record<string, unknown>) =>
  Object.values(body).some((value) => value !== undefined);
const AT_LEAST_ONE = { message: "Provide at least one field to update" };

export const UpdateHostBodySchema = z
  .object({
    note: AssetNoteSchema.optional(),
    tags: TagsSchema.optional(),
    triage: TriageStatusSchema.optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);

const OverrideSchema = z.string().min(1).max(200).regex(/\S/, "Must not be blank").nullable();

export const UpdateServiceBodySchema = z
  .object({
    note: AssetNoteSchema.optional(),
    tags: TagsSchema.optional(),
    triage: TriageStatusSchema.optional(),
    /** `null` removes the correction, so the observed value shows again. */
    nameOverride: OverrideSchema.optional(),
    productOverride: OverrideSchema.optional(),
    versionOverride: OverrideSchema.optional(),
  })
  .refine(atLeastOneField, AT_LEAST_ONE);

export const HostServiceParamsSchema = z.object({ id: z.uuid(), serviceId: z.uuid() });

export type TriageStatus = z.infer<typeof TriageStatusSchema>;
export type ServiceIdentity = z.infer<typeof ServiceIdentitySchema>;
export type HttpSummary = z.infer<typeof HttpSummarySchema>;
export type ServiceSummary = z.infer<typeof ServiceSummarySchema>;
export type HostLastStatus = z.infer<typeof HostLastStatusSchema>;
export type HostListItem = z.infer<typeof HostListItemSchema>;
export type ServiceDetail = z.infer<typeof ServiceDetailSchema>;
export type HostHistoryEntry = z.infer<typeof HostHistoryEntrySchema>;
export type HostDetail = z.infer<typeof HostDetailSchema>;
export type HostListQuery = z.infer<typeof HostListQuerySchema>;
export type HostListResponse = z.infer<typeof HostListResponseSchema>;
export type UpdateHostBody = z.infer<typeof UpdateHostBodySchema>;
export type UpdateServiceBody = z.infer<typeof UpdateServiceBodySchema>;
export type HostServiceParams = z.infer<typeof HostServiceParamsSchema>;

/** What to display for a service: the user's correction where there is one. */
export function effectiveServiceIdentity(
  service: Pick<ServiceSummary, "observed" | "overrides">,
): ServiceIdentity {
  return {
    name: service.overrides.name ?? service.observed.name,
    product: service.overrides.product ?? service.observed.product,
    version: service.overrides.version ?? service.observed.version,
  };
}

export function hasServiceOverrides(service: Pick<ServiceSummary, "overrides">): boolean {
  const { name, product, version } = service.overrides;
  return name !== null || product !== null || version !== null;
}
