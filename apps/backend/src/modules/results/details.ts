import { z } from "zod";

import { HttpSummarySchema, type HttpSummary } from "@subsurf/contracts/hosts/hosts.schema";
import {
  HttpEndpointSchema,
  OpenPortSchema,
  TlsCertificateSchema,
  type HttpEndpoint,
  type OpenPort,
} from "@subsurf/contracts/workers/worker-result.schema";

import type { PortObservation } from "~backend/generated/prisma/client";
import { decryptJson, encryptJson, encryptNullable } from "~backend/lib/crypto";

const EncryptedSchema = z.strictObject({ $enc: z.string() });
const BodySchema = HttpEndpointSchema.shape.body.unwrap();
const TlsSchema = HttpEndpointSchema.shape.tls.unwrap();

const StoredHttpEndpointSchema = HttpEndpointSchema.extend({
  headers: EncryptedSchema,
  cookies: EncryptedSchema,
  body: BodySchema.extend({ content: EncryptedSchema.nullable() }).nullable(),
  tls: TlsSchema.extend({ cert: EncryptedSchema }).nullable(),
  probes: EncryptedSchema,
});

/**
 * `PortObservation.details`: the worker's port object without the columns, with the fields
 * docs/worker-result-format.md lists as sensitive encrypted in place.
 */
const StoredPortDetailsSchema = z.object({
  identity: OpenPortSchema.shape.identity,
  banner: EncryptedSchema.nullable(),
  scripts: EncryptedSchema,
  http: z.array(StoredHttpEndpointSchema),
});

export type StoredPortDetails = z.infer<typeof StoredPortDetailsSchema>;
type StoredHttpEndpoint = z.infer<typeof StoredHttpEndpointSchema>;
type Encrypted = z.infer<typeof EncryptedSchema>;

export type PortDetails = Pick<OpenPort, "identity" | "banner" | "scripts" | "http">;

const open = <T extends z.ZodType>(schema: T, value: Encrypted): z.infer<T> =>
  schema.parse(decryptJson(value));

export function sealPortDetails(port: OpenPort): StoredPortDetails {
  return {
    identity: port.identity,
    banner: encryptNullable(port.banner),
    scripts: encryptJson(port.scripts),
    http: port.http.map(sealHttpEndpoint),
  };
}

/** Reads `details` back from the database; throws if it does not have the stored shape. */
export function openPortDetails(stored: unknown): PortDetails {
  const details = StoredPortDetailsSchema.parse(stored);
  return {
    identity: details.identity,
    banner: details.banner === null ? null : open(z.string(), details.banner),
    scripts: open(OpenPortSchema.shape.scripts, details.scripts),
    http: details.http.map(openHttpEndpoint),
  };
}

function sealHttpEndpoint(endpoint: HttpEndpoint): StoredHttpEndpoint {
  const { body, tls } = endpoint;
  return {
    ...endpoint,
    headers: encryptJson(endpoint.headers),
    cookies: encryptJson(endpoint.cookies),
    body: body === null ? null : { ...body, content: encryptNullable(body.content) },
    tls: tls === null ? null : { ...tls, cert: encryptJson(tls.cert) },
    probes: encryptJson(endpoint.probes),
  };
}

function openHttpEndpoint(endpoint: StoredHttpEndpoint): HttpEndpoint {
  const { body, tls } = endpoint;
  return {
    ...endpoint,
    headers: open(HttpEndpointSchema.shape.headers, endpoint.headers),
    cookies: open(HttpEndpointSchema.shape.cookies, endpoint.cookies),
    body:
      body === null
        ? null
        : { ...body, content: body.content === null ? null : open(z.string(), body.content) },
    tls: tls === null ? null : { ...tls, cert: open(TlsCertificateSchema, tls.cert) },
    probes: open(HttpEndpointSchema.shape.probes, endpoint.probes),
  };
}

const StoredHttpSummariesSchema = z.object({ http: z.array(HttpSummarySchema) });

/** The plaintext fields of `details.http[]`, without decrypting anything (list views). */
export function httpSummaries(stored: unknown): HttpSummary[] {
  return StoredHttpSummariesSchema.parse(stored).http;
}

export type StoredPortRow = Pick<
  PortObservation,
  | "protocol"
  | "port"
  | "reason"
  | "serviceName"
  | "serviceProduct"
  | "serviceVersion"
  | "serviceExtraInfo"
  | "serviceCpe"
  | "serviceMethod"
  | "serviceConfidence"
  | "details"
>;

/** The worker's port object again, from a stored row (decrypts `details` unless given). */
export function storedOpenPort(
  row: StoredPortRow,
  details: PortDetails = openPortDetails(row.details),
): OpenPort {
  return {
    port: row.port,
    protocol: row.protocol,
    state: "open",
    reason: row.reason,
    service:
      row.serviceName === null
        ? null
        : {
            name: row.serviceName,
            product: row.serviceProduct,
            version: row.serviceVersion,
            extraInfo: row.serviceExtraInfo,
            cpe: row.serviceCpe,
            method: row.serviceMethod === "table" ? "table" : "probed",
            confidence: row.serviceConfidence ?? 0,
          },
    ...details,
  };
}
