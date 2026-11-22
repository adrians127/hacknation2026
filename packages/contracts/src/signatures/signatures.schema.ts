import { z } from "zod";

import { NonBlankStringSchema } from "../common/common.schema";
import {
  SignatureCategorySchema,
  SignatureConfidenceSchema,
  SignatureEvidenceSchema,
  SignatureSeveritySchema,
} from "./detection.schema";

const CountSchema = z.number().int().nonnegative();
const TimestampSchema = z.iso.datetime();

export const SIGNATURE_MATCHER_MAX = 500;
export const SIGNATURE_REGEX_MAX = 300;
export const SIGNATURE_VERSION_PATTERN_MAX = 200;
export const SIGNATURE_CONDITIONS_MAX = 10;
/** Custom signatures; built-ins do not count. */
export const SIGNATURES_MAX = 500;
/** Distinct probe paths across enabled signatures; the rest of a job's 128 stay for the pipeline step's own. */
export const SIGNATURE_PROBE_PATHS_MAX = 32;
export const SIGNATURE_PREVIEW_SAMPLES = 20;

/**
 * - `equals`, `contains`, `prefix`: plain text;
 * - `regex`: RE2 syntax (no lookarounds or backreferences), checked by the backend; it runs in linear
 *   time, so a pattern cannot stall the server.
 */
export const SignatureMatchOpSchema = z.enum(["equals", "contains", "prefix", "regex"]);

export const SignatureMatcherSchema = z
  .object({
    op: SignatureMatchOpSchema,
    value: z.string().min(1).max(SIGNATURE_MATCHER_MAX),
    /** Ignoring case when absent. */
    caseSensitive: z.boolean().optional(),
  })
  .refine((matcher) => matcher.op !== "regex" || matcher.value.length <= SIGNATURE_REGEX_MAX, {
    message: `A regular expression may have at most ${SIGNATURE_REGEX_MAX} characters`,
    path: ["value"],
  });

/**
 * RE2 pattern with a capture group, run on the text the condition reads (header value, title, page,
 * banner, service field, probe title): group 1 is the version (`WordPress (\d[\d.]*)`). It never
 * decides whether the condition matches.
 */
export const SignatureVersionPatternSchema = z.string().min(1).max(SIGNATURE_VERSION_PATTERN_MAX);

/**
 * A path the scanner fetches with a plain GET, without following redirects. No query string,
 * fragment, `..`, `@` or backslash, so a probe cannot carry credentials or leave the site.
 */
export const SignatureProbePathSchema = z
  .string()
  .max(200)
  .regex(/^\/(?!\/)[!-~]*$/, "Must start with a single / and hold printable ASCII without spaces")
  .refine((path) => !/\.\.|%2e|[?#\\@]/i.test(path), {
    message: "Must not contain ?, #, @, \\, .. or %2e",
  });

const PortSchema = z.number().int().min(1).max(65535);
const StatusCodeSchema = z.number().int().min(100).max(599);
const Mmh3Schema = z.number().int().min(-2_147_483_648).max(2_147_483_647);

/** The nmap service fields a `service` condition can read (the observation, not users' corrections). */
export const SignatureServiceFieldSchema = z.enum(["name", "product", "version", "extraInfo", "cpe"]);

export const SignatureConditionSchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("header"),
    /** Header names are compared as the scanner stores them: lowercase. */
    name: SignatureMatcherSchema,
    /** Absent: the header being there is enough. */
    value: SignatureMatcherSchema.optional(),
    version: SignatureVersionPatternSchema.optional(),
  }),
  /** Only cookie names: the scanner never keeps cookie values. */
  z.object({ target: z.literal("cookie"), name: SignatureMatcherSchema }),
  z.object({
    target: z.literal("title"),
    value: SignatureMatcherSchema,
    version: SignatureVersionPatternSchema.optional(),
  }),
  /** The page's HTML (the first 256 KiB the scanner kept). */
  z.object({
    target: z.literal("body"),
    value: SignatureMatcherSchema,
    version: SignatureVersionPatternSchema.optional(),
  }),
  /** MurmurHash3 of the base64 favicon, as Shodan writes it (`http.favicon.hash`). */
  z.object({ target: z.literal("favicon"), mmh3: z.array(Mmh3Schema).min(1).max(50) }),
  /** The path answered with one of these codes; its body is not kept, only title and redirect. */
  z.object({
    target: z.literal("probe"),
    path: SignatureProbePathSchema,
    status: z.array(StatusCodeSchema).min(1).max(10),
    title: SignatureMatcherSchema.optional(),
    location: SignatureMatcherSchema.optional(),
    /** Read from the probe's title. */
    version: SignatureVersionPatternSchema.optional(),
  }),
  /** What a non-HTTP service sent first (SSH, FTP, SMTP). */
  z.object({
    target: z.literal("banner"),
    value: SignatureMatcherSchema,
    version: SignatureVersionPatternSchema.optional(),
  }),
  z.object({
    target: z.literal("service"),
    field: SignatureServiceFieldSchema,
    value: SignatureMatcherSchema,
    version: SignatureVersionPatternSchema.optional(),
  }),
  /** Narrows the other conditions to these ports; never enough on its own. */
  z.object({ target: z.literal("port"), ports: z.array(PortSchema).min(1).max(100) }),
]);

/**
 * - `all`: every condition holds; the HTTP ones on the same endpoint (page) of the service;
 * - `any`: at least one condition holds anywhere on the service.
 */
export const SignatureMatchModeSchema = z.enum(["all", "any"]);

export const SignatureDefinitionSchema = z
  .object({
    match: SignatureMatchModeSchema,
    conditions: z.array(SignatureConditionSchema).min(1).max(SIGNATURE_CONDITIONS_MAX),
  })
  .refine((definition) => definition.conditions.some((condition) => condition.target !== "port"), {
    message: "Add a condition other than a port",
    path: ["conditions"],
  });

export const SignatureNameSchema = NonBlankStringSchema.max(100);
export const SignatureDescriptionSchema = z.string().max(2000);
/** The technology the signature identifies, as the technologies report names it. */
export const SignatureProductSchema = NonBlankStringSchema.max(100);

const UserRefSchema = z.object({ id: z.uuid(), displayName: z.string() });
const ScanRefSchema = z.object({ id: z.uuid(), startedAt: TimestampSchema.nullable() });

export const SignatureSchema = z.object({
  id: z.uuid(),
  /** Built-ins only: a stable name that export and import use. */
  key: z.string().nullable(),
  /** Shipped with SubSurf: it can be switched off or duplicated, not edited or deleted. */
  builtIn: z.boolean(),
  name: z.string(),
  /** Free text from users; empty when there is none. */
  description: z.string(),
  category: SignatureCategorySchema,
  product: z.string().nullable(),
  severity: SignatureSeveritySchema.nullable(),
  /** The least confidence of a match; more independent sources can raise it. */
  confidence: SignatureConfidenceSchema,
  enabled: z.boolean(),
  definition: SignatureDefinitionSchema,
  /** Matches in the newest scan with results; `null` until that scan has been evaluated. */
  hits: z.object({ hosts: CountSchema, services: CountSchema }).nullable(),
  createdBy: UserRefSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

export const SignatureListResponseSchema = z.object({
  items: z.array(SignatureSchema),
  /** Paths the enabled signatures need; the scanner requests them on every HTTP service. */
  probePaths: z.array(z.string()),
  evaluation: z.object({
    /** The newest scan with results, which `hits` describe. */
    scan: ScanRefSchema.nullable(),
    /** Scans whose matches are not yet up to date with the enabled signatures. */
    pendingScans: CountSchema,
  }),
});

export const CreateSignatureBodySchema = z.object({
  name: SignatureNameSchema,
  description: SignatureDescriptionSchema.optional(),
  category: SignatureCategorySchema,
  product: SignatureProductSchema.nullable().optional(),
  severity: SignatureSeveritySchema.nullable().optional(),
  confidence: SignatureConfidenceSchema,
  enabled: z.boolean().optional(),
  definition: SignatureDefinitionSchema,
});

export const UpdateSignatureBodySchema = z
  .object({
    name: SignatureNameSchema.optional(),
    description: SignatureDescriptionSchema.optional(),
    category: SignatureCategorySchema.optional(),
    product: SignatureProductSchema.nullable().optional(),
    severity: SignatureSeveritySchema.nullable().optional(),
    confidence: SignatureConfidenceSchema.optional(),
    enabled: z.boolean().optional(),
    definition: SignatureDefinitionSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

export const SignaturePreviewBodySchema = z.object({
  definition: SignatureDefinitionSchema,
  confidence: SignatureConfidenceSchema.optional(),
  /** Any scan with results; the newest one when absent. */
  scanId: z.uuid().optional(),
});

export const SignaturePreviewSampleSchema = z.object({
  hostId: z.uuid(),
  serviceId: z.uuid(),
  ip: z.ipv4(),
  port: z.number().int(),
  confidence: SignatureConfidenceSchema,
  version: z.string().nullable(),
  evidence: z.array(SignatureEvidenceSchema),
});

export const SignaturePreviewResponseSchema = z.object({
  scan: ScanRefSchema.nullable(),
  services: CountSchema,
  hosts: CountSchema,
  samples: z.array(SignaturePreviewSampleSchema).max(SIGNATURE_PREVIEW_SAMPLES),
  /** Probe paths of the definition that this scan did not request, so they cannot match there yet. */
  unprobedPaths: z.array(z.string()),
});

/** One signature in an export file. A built-in is identified by `key`; import only switches it on or off. */
export const SignatureExportItemSchema = z.object({
  key: z.string().max(100).nullable().optional(),
  name: SignatureNameSchema,
  description: SignatureDescriptionSchema.optional(),
  category: SignatureCategorySchema,
  product: SignatureProductSchema.nullable().optional(),
  severity: SignatureSeveritySchema.nullable().optional(),
  confidence: SignatureConfidenceSchema,
  enabled: z.boolean().optional(),
  definition: SignatureDefinitionSchema,
});

/** `GET /signatures/export` writes it and `POST /signatures/import` reads it (docs/signature-format.md). */
export const SignatureExportDocumentSchema = z.object({
  format: z.literal("subsurf.signatures"),
  version: z.literal(1),
  exportedAt: TimestampSchema.optional(),
  signatures: z.array(SignatureExportItemSchema).max(SIGNATURES_MAX * 2),
});

export const SignatureExportQuerySchema = z.object({
  /** Also the built-ins (with their key and whether they are on). */
  builtIn: z.enum(["true", "false"]).optional(),
});

/**
 * A custom signature whose name is taken: `skip` keeps the existing one, `replace` overwrites it.
 * Either way the import is all or nothing.
 */
export const SignatureImportQuerySchema = z.object({
  conflict: z.enum(["skip", "replace"]).optional(),
});

export const SignatureImportResponseSchema = z.object({
  created: CountSchema,
  replaced: CountSchema,
  skipped: CountSchema,
  /** Built-ins switched on or off by the file. */
  builtIn: CountSchema,
});

export type SignatureMatchOp = z.infer<typeof SignatureMatchOpSchema>;
export type SignatureMatcher = z.infer<typeof SignatureMatcherSchema>;
export type SignatureServiceField = z.infer<typeof SignatureServiceFieldSchema>;
export type SignatureCondition = z.infer<typeof SignatureConditionSchema>;
export type SignatureMatchMode = z.infer<typeof SignatureMatchModeSchema>;
export type SignatureDefinition = z.infer<typeof SignatureDefinitionSchema>;
export type Signature = z.infer<typeof SignatureSchema>;
export type SignatureListResponse = z.infer<typeof SignatureListResponseSchema>;
export type CreateSignatureBody = z.infer<typeof CreateSignatureBodySchema>;
export type UpdateSignatureBody = z.infer<typeof UpdateSignatureBodySchema>;
export type SignaturePreviewBody = z.infer<typeof SignaturePreviewBodySchema>;
export type SignaturePreviewSample = z.infer<typeof SignaturePreviewSampleSchema>;
export type SignaturePreviewResponse = z.infer<typeof SignaturePreviewResponseSchema>;
export type SignatureExportItem = z.infer<typeof SignatureExportItemSchema>;
export type SignatureExportDocument = z.infer<typeof SignatureExportDocumentSchema>;
export type SignatureExportQuery = z.infer<typeof SignatureExportQuerySchema>;
export type SignatureImportQuery = z.infer<typeof SignatureImportQuerySchema>;
export type SignatureImportResponse = z.infer<typeof SignatureImportResponseSchema>;
