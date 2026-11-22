import { z } from "zod";

// Own file without imports: scan, report and DefectDojo schemas use it, and signatures.schema.ts imports it.

/** The seven technology categories (technologies report) plus what a detection can flag. */
export const SIGNATURE_TECHNOLOGY_CATEGORIES = [
  "cms",
  "web-server",
  "language",
  "framework",
  "application",
  "device",
  "service",
] as const;

export const SignatureCategorySchema = z.enum([
  ...SIGNATURE_TECHNOLOGY_CATEGORIES,
  "admin-panel",
  "staging",
  "default-page",
  "interesting-header",
  "interesting-cookie",
  "other",
]);

/** `null` on a signature: it only identifies something, it is not a finding. */
export const SignatureSeveritySchema = z.enum(["info", "low", "medium", "high"]);

export const SignatureConfidenceSchema = z.enum(["high", "medium", "low"]);

/** What a condition reads; also where a detection's evidence came from. */
export const SignatureTargetSchema = z.enum([
  "header",
  "cookie",
  "title",
  "body",
  "favicon",
  "probe",
  "banner",
  "service",
  "port",
]);

/** The signature that matched (`/signatures`). */
export const SignatureRefSchema = z.object({
  id: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
});

/** One piece of what matched: a header, a cookie name, a fragment of the page with its context. */
export const SignatureEvidenceSchema = z.object({
  target: SignatureTargetSchema,
  /** The HTTP endpoint (or probe) it came from; `null` for service-level targets. */
  url: z.string().nullable(),
  /** Header or cookie name, probe path, service field; `null` when there is none. */
  key: z.string().nullable(),
  /** The matched text with a little context, cut short; never a cookie value. */
  value: z.string(),
});

/** A signature that matched a service in one scan. */
export const DetectionSummarySchema = z.object({
  signatureId: z.uuid(),
  key: z.string().nullable(),
  name: z.string(),
  category: SignatureCategorySchema,
  product: z.string().nullable(),
  severity: SignatureSeveritySchema.nullable(),
  confidence: SignatureConfidenceSchema,
  /** Taken from the page by the signature's version pattern. */
  version: z.string().nullable(),
  builtIn: z.boolean(),
});

export const DetectionSchema = DetectionSummarySchema.extend({
  sources: z.array(SignatureTargetSchema),
  evidence: z.array(SignatureEvidenceSchema),
});

export type SignatureCategory = z.infer<typeof SignatureCategorySchema>;
export type SignatureSeverity = z.infer<typeof SignatureSeveritySchema>;
export type SignatureConfidence = z.infer<typeof SignatureConfidenceSchema>;
export type SignatureTarget = z.infer<typeof SignatureTargetSchema>;
export type SignatureRef = z.infer<typeof SignatureRefSchema>;
export type SignatureEvidence = z.infer<typeof SignatureEvidenceSchema>;
export type DetectionSummary = z.infer<typeof DetectionSummarySchema>;
export type Detection = z.infer<typeof DetectionSchema>;
