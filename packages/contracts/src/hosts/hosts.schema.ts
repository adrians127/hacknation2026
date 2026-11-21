import { z } from "zod";

import { TagsSchema } from "../common/common.schema";
import { HttpEndpointSchema } from "../workers/worker-result.schema";

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

/** The user-owned fields of a host (PDF item 14): no scan ever changes them. */
export const HostEditsSchema = z.object({
  id: z.uuid(),
  triage: TriageStatusSchema,
  tags: z.array(z.string()),
  note: z.string(),
});

export const ServiceEditsSchema = HostEditsSchema.extend({
  /** User corrections (`null` = not corrected). */
  overrides: ServiceIdentitySchema,
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
export type HostEdits = z.infer<typeof HostEditsSchema>;
export type ServiceEdits = z.infer<typeof ServiceEditsSchema>;
export type UpdateHostBody = z.infer<typeof UpdateHostBodySchema>;
export type UpdateServiceBody = z.infer<typeof UpdateServiceBodySchema>;
export type HostServiceParams = z.infer<typeof HostServiceParamsSchema>;

interface CorrectableService {
  observed: ServiceIdentity;
  overrides: ServiceIdentity;
}

/** What to display for a service: the user's correction where there is one. */
export function effectiveServiceIdentity(service: CorrectableService): ServiceIdentity {
  return {
    name: service.overrides.name ?? service.observed.name,
    product: service.overrides.product ?? service.observed.product,
    version: service.overrides.version ?? service.observed.version,
  };
}

export function hasServiceOverrides(service: Pick<CorrectableService, "overrides">): boolean {
  const { name, product, version } = service.overrides;
  return name !== null || product !== null || version !== null;
}
