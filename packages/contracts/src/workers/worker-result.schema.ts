import { z } from "zod";

import { PortSpecSchema } from "../scans/scans.schema";

// The locked format in docs/worker-result-format.md: change that document first, then this file.

/** A job never holds more addresses than this (`SCAN_BATCH_SIZE` and `NmapJob` cap it too). */
export const MAX_JOB_ADDRESSES = 1024;

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "Must be a lowercase hex SHA-256");
const HostnameSchema = z.string().min(1).max(253);
const NonNegativeIntSchema = z.number().int().nonnegative();
const DurationMsSchema = NonNegativeIntSchema;
const TcpPortSchema = z.number().int().min(1).max(65535);

export const WorkerErrorSchema = z.object({
  code: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be kebab-case"),
  message: z.string(),
});

export const WorkerResultStatusSchema = z.enum(["completed", "partial", "failed"]);
export const WorkerStopReasonSchema = z.enum(["deadline", "stop-requested", "lease-lost", "error"]);
export const HostStatusSchema = z.enum(["up", "down", "timeout", "cancelled", "failed"]);
export const HostnameSourceSchema = z.enum(["job", "ptr", "tls-san"]);

export const WorkerScanSchema = z.object({
  jobId: z.uuid(),
  leaseId: z.string().min(1).max(256),
  scanId: z.uuid(),
  worker: z.object({
    id: z.string().min(1).max(128),
    version: z.string().min(1).max(64),
    nmapVersion: z.string().min(1).max(64).nullable(),
  }),
  status: WorkerResultStatusSchema,
  stopReason: WorkerStopReasonSchema.nullable(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  durationMs: DurationMsSchema,
  phasesMs: z.object({
    hostDiscovery: DurationMsSchema,
    portScan: DurationMsSchema,
    serviceDetection: DurationMsSchema,
    http: DurationMsSchema,
  }),
  params: z.object({
    subnet: z.cidrv4(),
    ports: PortSpecSchema,
    maxParallel: z.number().int().positive(),
    maxRatePerProcess: z.number().int().positive(),
    hostTimeoutMs: z.number().int().positive(),
    httpTimeoutMs: z.number().int().positive(),
    maxBodyBytes: z.number().int().positive(),
    maxRedirects: NonNegativeIntSchema,
    nmapArgs: z.array(z.string()),
  }),
  counts: z.object({
    addresses: NonNegativeIntSchema,
    up: NonNegativeIntSchema,
    down: NonNegativeIntSchema,
    timeout: NonNegativeIntSchema,
    cancelled: NonNegativeIntSchema,
    failed: NonNegativeIntSchema,
    openPorts: NonNegativeIntSchema,
    httpEndpoints: NonNegativeIntSchema,
    httpRequests: NonNegativeIntSchema,
  }),
  error: WorkerErrorSchema.nullable(),
});

export const TlsCertificateSchema = z.object({
  subjectCn: z.string().nullable(),
  san: z.array(z.string()),
  issuer: z.string().nullable(),
  notBefore: z.iso.datetime(),
  notAfter: z.iso.datetime(),
  serial: z.string(),
  sha256: Sha256HexSchema,
  selfSigned: z.boolean(),
  keyAlgorithm: z.string(),
  keyBits: z.number().int().positive().nullable(),
});

export const HttpEndpointSchema = z.object({
  scheme: z.enum(["http", "https"]),
  /** Host header and SNI; `null` = requested by bare IP. */
  vhost: HostnameSchema.nullable(),
  url: z.url(),
  finalUrl: z.url(),
  /** `null` when there was no response (`error` is set). */
  statusCode: z.number().int().min(100).max(599).nullable(),
  title: z.string().nullable(),
  /** Without `Set-Cookie`: cookies are parsed into `cookies`. */
  headers: z.array(z.object({ name: z.string().min(1), value: z.string() })),
  cookies: z.array(
    z.object({
      name: z.string().min(1),
      /** The value itself never leaves the worker. */
      valueSha256: Sha256HexSchema,
      secure: z.boolean(),
      httpOnly: z.boolean(),
      sameSite: z.enum(["Strict", "Lax", "None"]).nullable(),
      domain: z.string().nullable(),
      path: z.string().nullable(),
      expires: z.string().nullable(),
    }),
  ),
  redirects: z.array(
    z.object({
      url: z.url(),
      statusCode: z.number().int().min(300).max(399),
      location: z.string(),
      followed: z.boolean(),
    }),
  ),
  /** `null` when there was no response. */
  body: z
    .object({
      sha256: Sha256HexSchema,
      size: NonNegativeIntSchema,
      contentType: z.string().nullable(),
      /** Text types only, cut at `params.maxBodyBytes`. */
      content: z.string().nullable(),
      truncated: z.boolean(),
    })
    .nullable(),
  favicon: z
    .object({
      url: z.url(),
      mmh3: z.number().int().min(-(2 ** 31)).max(2 ** 31 - 1),
      sha256: Sha256HexSchema,
    })
    .nullable(),
  tls: z
    .object({
      version: z.string(),
      cipher: z.string(),
      alpn: z.string().nullable(),
      cert: TlsCertificateSchema,
    })
    .nullable(),
  probes: z.array(
    z.object({
      path: z.string().startsWith("/"),
      statusCode: z.number().int().min(100).max(599).nullable(),
      location: z.string().nullable(),
      title: z.string().nullable(),
      size: NonNegativeIntSchema.nullable(),
      bodySha256: Sha256HexSchema.nullable(),
      error: WorkerErrorSchema.nullable(),
    }),
  ),
  error: WorkerErrorSchema.nullable(),
});

export const OpenPortSchema = z
  .object({
    port: TcpPortSchema,
    protocol: z.literal("tcp"),
    /** Only open ports are reported; kept for future UDP (`open|filtered`). */
    state: z.literal("open"),
    reason: z.string().nullable(),
    service: z
      .object({
        name: z.string().min(1),
        product: z.string().nullable(),
        version: z.string().nullable(),
        extraInfo: z.string().nullable(),
        cpe: z.array(z.string()),
        method: z.enum(["probed", "table"]),
        /** Nmap's `conf`. */
        confidence: z.number().int().min(0).max(10),
      })
      .nullable(),
    /** Signals that tell machines behind one IP apart (NAT, port forwarding). */
    identity: z.object({
      ttl: z.number().int().min(0).max(255).nullable(),
      sshHostKeySha256: Sha256HexSchema.nullable(),
      tlsCertSha256: Sha256HexSchema.nullable(),
    }),
    banner: z.string().nullable(),
    scripts: z.array(z.object({ id: z.string().min(1), output: z.string() })),
    http: z.array(HttpEndpointSchema),
  })
  .refine((port) => isUnique(port.http.map((entry) => `${entry.scheme} ${entry.vhost ?? ""}`)), {
    message: "Each (scheme, vhost) may appear once per port",
    path: ["http"],
  });

export const ObservedHostSchema = z
  .object({
    ip: z.ipv4(),
    status: HostStatusSchema,
    reason: z.string().nullable(),
    /** `null` for `cancelled`: never scanned. */
    observedAt: z.iso.datetime().nullable(),
    latencyMs: NonNegativeIntSchema.nullable(),
    hostnames: z.array(z.object({ name: HostnameSchema, source: HostnameSourceSchema })),
    error: WorkerErrorSchema.nullable(),
    ports: z.array(OpenPortSchema).max(65535),
  })
  .refine((host) => host.status === "up" || host.ports.length === 0, {
    message: "Only an `up` host can have open ports",
    path: ["ports"],
  })
  .refine((host) => isUnique(host.ports.map((port) => `${port.protocol}/${port.port}`)), {
    message: "Each port may appear once per host",
    path: ["ports"],
  });

/** What a worker returns for one job (docs/worker-result-format.md). */
export const WorkerResultSchema = z
  .object({
    scan: WorkerScanSchema,
    hosts: z.array(ObservedHostSchema).max(MAX_JOB_ADDRESSES),
  })
  .refine((result) => isUnique(result.hosts.map((host) => host.ip)), {
    message: "Each address may appear once",
    path: ["hosts"],
  });

function isUnique(keys: readonly string[]): boolean {
  return new Set(keys).size === keys.length;
}

export type WorkerResult = z.infer<typeof WorkerResultSchema>;
export type WorkerScan = z.infer<typeof WorkerScanSchema>;
export type ObservedHost = z.infer<typeof ObservedHostSchema>;
export type OpenPort = z.infer<typeof OpenPortSchema>;
export type HttpEndpoint = z.infer<typeof HttpEndpointSchema>;
export type HostStatus = z.infer<typeof HostStatusSchema>;
