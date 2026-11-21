import { z } from "zod";

import { PortSpecSchema, ScanStatusSchema } from "../scans/scans.schema";
import { cidrToRange, intToIpv4, ipv4ToInt, parseCidr } from "../targets/ipv4";

export const RESULT_SCHEMA_VERSION = "1.0";

const MAX_TEXT = 8192;
const MAX_EVIDENCE_VALUE = 1024;
const MAX_BODY_EXCERPT = 65_536;

/** Becomes `x-sensitive` in the JSON Schema: the backend encrypts it at rest (PDF item 16). */
const sensitive = <T extends z.ZodType>(schema: T, description: string) =>
  schema.meta({ description, "x-sensitive": true });

const TimestampSchema = z.iso.datetime().meta({ id: "Timestamp", description: "UTC, ISO 8601" });
const CountSchema = z.number().int().nonnegative();
const DurationMsSchema = z.number().int().nonnegative();
const PortNumberSchema = z.number().int().min(1).max(65535);
const HttpStatusSchema = z.number().int().min(100).max(599);
const HostnameSchema = z.string().min(1).max(253);
const TextSchema = z.string().max(MAX_TEXT);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const HttpUrlSchema = z.url({ protocol: /^https?$/ });
const UrlPathSchema = z.string().max(2048).regex(/^\//);

export const ConfidenceSchema = z
  .number()
  .int()
  .min(0)
  .max(100)
  .meta({ id: "Confidence", description: "Percent, 0-100" });

const ErrorSchema = z.object({ code: z.string().min(1).max(64), message: TextSchema });

// ---------------------------------------------------------------- analysis

export const TechnologyCategorySchema = z.enum([
  "cms",
  "web_application",
  "framework",
  "web_server",
  "app_server",
  "programming_language",
  "javascript_library",
  "database",
  "operating_system",
  "iot_device",
  "network_device",
  "cdn",
  "waf",
  "proxy",
  "other",
]);

export const ObservationKindSchema = z.enum([
  "admin_panel",
  "login_page",
  "staging_environment",
  "test_environment",
  "development_environment",
  "default_page",
  "directory_listing",
  "version_disclosure",
  "outdated_component",
  "debug_mode",
  "interesting_header",
  "interesting_cookie",
  "insecure_cookie",
  "missing_security_header",
  "cleartext_login",
  "tls_self_signed",
  "tls_expired",
  "tls_hostname_mismatch",
  "tls_untrusted",
  "tls_weak_protocol",
  "unusual_banner",
  "signature_match",
  "other",
]);

/** Lowercased DefectDojo severities, so an observation exports to DefectDojo unchanged. */
export const SeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);

export const EvidenceSourceSchema = z.enum([
  "service_banner",
  "nmap_service",
  "os_fingerprint",
  "url",
  "redirect",
  "header",
  "cookie",
  "title",
  "meta_generator",
  "body",
  "favicon",
  "path",
  "tls_certificate",
]);

export const EvidenceSchema = z
  .object({
    source: EvidenceSourceSchema,
    hostname: HostnameSchema.nullable().describe("Endpoint the evidence comes from; null: the IP"),
    key: TextSchema.nullable().describe("Header or cookie name, probed path, certificate field"),
    value: z.string().max(MAX_EVIDENCE_VALUE).nullable().describe("Matched fragment, truncated"),
  })
  .meta({ id: "Evidence" });

export const DetectorSchema = z
  .object({
    kind: z.enum(["nmap", "builtin", "signature"]),
    signature_id: z.string().min(1).max(256).nullable(),
    signature_name: TextSchema.nullable(),
    signature_version: z.number().int().positive().nullable(),
  })
  .meta({ id: "Detector", description: "Set `signature_*` only for kind `signature`" });

export const TechnologySchema = z
  .object({
    name: z.string().min(1).max(128),
    category: TechnologyCategorySchema,
    version: z.string().max(128).nullable(),
    cpe: z.string().max(256).nullable(),
    confidence: ConfidenceSchema,
    detected_by: DetectorSchema,
    evidence: z.array(EvidenceSchema).min(1),
  })
  .meta({ id: "Technology" });

export const ObservationSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(256)
      .describe("Stable across scans: the diff and DefectDojo deduplication key"),
    kind: ObservationKindSchema,
    title: z.string().min(1).max(256),
    severity: SeveritySchema,
    confidence: ConfidenceSchema,
    detected_by: DetectorSchema,
    evidence: z.array(EvidenceSchema).min(1),
  })
  .meta({ id: "Observation" });

export const InterestSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    reasons: z.array(TextSchema),
  })
  .meta({ id: "Interest", description: "Analytical priority, higher is more worth a look" });

export const ChangeStatusSchema = z.enum([
  "new",
  "reappeared",
  "unchanged",
  "changed",
  "disappeared",
]);

export const DiffSchema = z
  .object({
    status: ChangeStatusSchema,
    first_seen_at: TimestampSchema,
    last_seen_at: TimestampSchema,
    missed_scans: CountSchema.describe("Consecutive scans without a response"),
    is_unstable: z.boolean().describe("Responded only in some of the recent scans"),
    changes: z.array(
      z.object({
        field: z.string().min(1).max(256).describe("Dotted path, e.g. `service.version`"),
        previous: TextSchema.nullable(),
        current: TextSchema.nullable(),
      }),
    ),
  })
  .meta({
    id: "Diff",
    description:
      "Comparison with `scan.previous_scan_id`, filled in by the backend; absent in worker output",
  });

// ---------------------------------------------------------------- TLS

export const TlsVersionSchema = z.enum([
  "SSLv2",
  "SSLv3",
  "TLSv1.0",
  "TLSv1.1",
  "TLSv1.2",
  "TLSv1.3",
]);

const DistinguishedNameSchema = z.object({
  raw: TextSchema,
  common_name: TextSchema.nullable(),
  organization: TextSchema.nullable(),
  organizational_unit: TextSchema.nullable(),
});

export const CertificateSchema = z
  .object({
    subject: DistinguishedNameSchema,
    issuer: DistinguishedNameSchema,
    serial_number: z.string().max(128).regex(/^[0-9a-f]+$/),
    not_before: TimestampSchema,
    not_after: TimestampSchema,
    san_dns: z.array(HostnameSchema),
    san_ip: z.array(z.union([z.ipv4(), z.ipv6()])),
    fingerprint_sha256: Sha256Schema,
    public_key: z.object({
      algorithm: z.string().min(1).max(64),
      bits: z.number().int().positive().nullable(),
    }),
    signature_algorithm: z.string().min(1).max(128),
    is_self_signed: z.boolean(),
    is_expired: z.boolean().describe("At `observed_at` of the port"),
    hostname_matches: z.boolean().nullable().describe("Against the endpoint hostname; null: none"),
    pem: z.string().max(MAX_TEXT).nullable(),
  })
  .meta({ id: "Certificate", description: "The leaf certificate" });

export const TlsInfoSchema = z
  .object({
    version: TlsVersionSchema,
    cipher: z.string().min(1).max(128),
    alpn: z.string().max(64).nullable(),
    accepted_versions: z
      .array(TlsVersionSchema)
      .describe("Versions accepted when probed one by one; empty when not probed"),
    certificate: CertificateSchema.nullable(),
    chain_length: CountSchema,
    is_trusted: z.boolean(),
    validation_error: TextSchema.nullable(),
  })
  .meta({ id: "TlsInfo" });

// ---------------------------------------------------------------- HTTP

export const CookieSchema = z
  .object({
    name: z.string().min(1).max(256),
    value: sensitive(z.string().max(MAX_TEXT).nullable(), "Omitted (null) unless configured"),
    domain: HostnameSchema.nullable(),
    path: z.string().max(2048).nullable(),
    expires: TimestampSchema.nullable(),
    max_age: z.number().int().nullable(),
    secure: z.boolean(),
    http_only: z.boolean(),
    same_site: z.enum(["strict", "lax", "none"]).nullable(),
    set_by_url: HttpUrlSchema,
  })
  .meta({ id: "Cookie" });

export const HttpHeaderSchema = z.object({ name: z.string().min(1).max(256), value: TextSchema });

export const HttpResponseSchema = z
  .object({
    protocol: z.enum(["HTTP/1.0", "HTTP/1.1", "HTTP/2", "HTTP/3"]),
    status_code: HttpStatusSchema,
    reason: z.string().max(256).nullable(),
    title: TextSchema.nullable(),
    meta_generator: TextSchema.nullable().describe('`<meta name="generator">`'),
    content_type: z.string().max(256).nullable(),
    headers: z
      .array(HttpHeaderSchema)
      .describe("In received order with duplicates; Set-Cookie is parsed into `cookies` instead"),
    body: z.object({
      size: CountSchema,
      sha256: Sha256Schema,
      truncated: z.boolean().describe("The excerpt is shorter than the body"),
      excerpt: sensitive(
        z.string().max(MAX_BODY_EXCERPT).nullable(),
        "Start of the body as text, for HTML-fragment and footer-version signatures",
      ),
    }),
  })
  .meta({ id: "HttpResponse", description: "The final response, after redirects" });

export const RedirectHopSchema = z.object({
  url: HttpUrlSchema,
  status_code: z.number().int().min(300).max(399),
  location: TextSchema.describe("As sent, may be relative"),
});

export const FaviconSchema = z
  .object({
    url: HttpUrlSchema,
    size: CountSchema,
    sha256: Sha256Schema,
    md5: z.string().regex(/^[0-9a-f]{32}$/),
    mmh3: z
      .number()
      .int()
      .min(-2_147_483_648)
      .max(2_147_483_647)
      .describe("MurmurHash3 of the base64-encoded icon, as Shodan computes it"),
  })
  .meta({ id: "Favicon" });

export const PathProbeSchema = z
  .object({
    path: UrlPathSchema,
    method: z.enum(["GET", "HEAD"]),
    status_code: HttpStatusSchema,
    title: TextSchema.nullable(),
    content_length: CountSchema.nullable(),
    body_sha256: Sha256Schema.nullable(),
    location: TextSchema.nullable(),
  })
  .meta({
    id: "PathProbe",
    description: "Safe detection only: GET/HEAD, no credentials, no request body",
  });

export const HttpInfoSchema = z
  .object({
    url: HttpUrlSchema,
    final_url: HttpUrlSchema,
    redirects: z.array(RedirectHopSchema).describe("In order; the final response is not a hop"),
    redirect_stop_reason: z
      .enum(["max_redirects", "out_of_scope", "loop"])
      .nullable()
      .describe("Why the chain was cut short; null when it ended on its own"),
    response_time_ms: DurationMsSchema,
    response: HttpResponseSchema,
    cookies: z.array(CookieSchema).describe("Set anywhere along the redirect chain"),
    favicon: FaviconSchema.nullable(),
    paths: z.array(PathProbeSchema),
  })
  .meta({ id: "HttpInfo" });

// ---------------------------------------------------------------- port and host

export const EndpointSchema = z
  .object({
    hostname: HostnameSchema.nullable().describe(
      "Sent as HTTP Host and TLS SNI; null when the service was addressed by its IP",
    ),
    tls: TlsInfoSchema.nullable(),
    http: HttpInfoSchema.nullable(),
    error: ErrorSchema.nullable(),
  })
  .meta({ id: "Endpoint", description: "One port seen under one name (virtual host)" });

export const ServiceSchema = z
  .object({
    name: z.string().min(1).max(64),
    product: TextSchema.nullable(),
    version: z.string().max(128).nullable(),
    extra_info: TextSchema.nullable(),
    hostname: HostnameSchema.nullable(),
    os_type: z.string().max(128).nullable(),
    device_type: z.string().max(128).nullable(),
    cpe: z.array(z.string().max(256)),
    tunnel: z.enum(["ssl"]).nullable(),
    method: z.enum(["probed", "table"]).describe("`table`: guessed from the port number only"),
    confidence: ConfidenceSchema.describe("Nmap `conf` × 10"),
    banner: TextSchema.nullable(),
    fingerprint: TextSchema.nullable().describe("Nmap `servicefp` of an unrecognized service"),
    scripts: z.array(z.object({ id: z.string().min(1).max(128), output: TextSchema })),
  })
  .meta({ id: "Service", description: "Nmap service and version detection (-sV)" });

export const PortStateSchema = z.enum([
  "open",
  "closed",
  "filtered",
  "unfiltered",
  "open|filtered",
  "closed|filtered",
  "not_reported",
]);

export const PortResultSchema = z
  .object({
    port: PortNumberSchema,
    protocol: z.enum(["tcp", "udp"]),
    state: PortStateSchema.describe("`not_reported`: requested but absent from Nmap output"),
    state_reason: z.string().max(64).nullable(),
    observed_at: TimestampSchema,
    service: ServiceSchema.nullable(),
    endpoints: z.array(EndpointSchema),
    technologies: z.array(TechnologySchema),
    observations: z.array(ObservationSchema),
    interest: InterestSchema.nullable(),
    diff: DiffSchema.optional(),
  })
  .meta({ id: "PortResult" });

export const HostnameSourceSchema = z.enum([
  "input",
  "ptr",
  "tls_certificate",
  "http_redirect",
  "service_banner",
]);

export const HostResultSchema = z
  .object({
    ip: z.ipv4(),
    hostnames: z.array(z.object({ name: HostnameSchema, source: HostnameSourceSchema })),
    state: z.enum(["up", "down", "unknown"]),
    state_reason: z.string().max(64).nullable(),
    scan_status: z.enum(["scanned", "pending", "failed", "timeout", "cancelled"]),
    error: ErrorSchema.nullable(),
    observed_at: TimestampSchema,
    latency_ms: z.number().nonnegative().nullable(),
    probe_attempts: z
      .object({ total: z.number().int().positive(), responded: CountSchema })
      .describe("Repeated measurements of an unstable host within this scan"),
    mac: z
      .object({ address: z.mac(), vendor: TextSchema.nullable() })
      .nullable()
      .describe("Same L2 segment only"),
    os: z
      .object({
        name: TextSchema,
        family: z.string().max(128).nullable(),
        vendor: z.string().max(128).nullable(),
        device_type: z.string().max(128).nullable(),
        accuracy: ConfidenceSchema,
        cpe: z.array(z.string().max(256)),
      })
      .nullable()
      .describe("Nmap OS detection (-O); null when disabled"),
    ports: z.array(PortResultSchema),
    interest: InterestSchema.nullable(),
    diff: DiffSchema.optional(),
  })
  .meta({ id: "HostResult" });

export const SubnetResultSchema = z
  .object({
    cidr: z.cidrv4(),
    summary: z.object({
      addresses_scanned: CountSchema,
      hosts_up: CountSchema,
      open_ports: CountSchema,
    }),
    hosts: z
      .array(HostResultSchema)
      .describe(
        "Hosts that responded, failed to scan or disappeared; silent addresses are only counted",
      ),
  })
  .meta({ id: "SubnetResult" });

// ---------------------------------------------------------------- document

export const ScanInfoSchema = z
  .object({
    id: z.string().min(1).max(256),
    status: ScanStatusSchema,
    stop_reason: z.enum(["window_expired", "cancelled", "error"]).nullable(),
    started_at: TimestampSchema.nullable(),
    finished_at: TimestampSchema.nullable(),
    duration_ms: DurationMsSchema.nullable(),
    window: z.object({ starts_at: TimestampSchema, ends_at: TimestampSchema }).nullable(),
    previous_scan_id: z.string().min(1).max(256).nullable(),
    scanner: z.object({
      name: z.string().min(1).max(128),
      version: z.string().min(1).max(64),
      nmap_version: z.string().max(64).nullable(),
    }),
    parameters: z.object({
      ports: PortSpecSchema,
      max_rate: z.number().int().positive().describe("Packets per second"),
      scan_type: z.enum(["connect", "syn"]),
      service_detection: z.boolean(),
      os_detection: z.boolean(),
      http_probing: z.boolean(),
      probed_paths: z.array(UrlPathSchema),
      signature_count: CountSchema,
    }),
  })
  .meta({ id: "ScanInfo" });

export const ResultSummarySchema = z.object({
  subnets: CountSchema,
  addresses_total: CountSchema,
  addresses_scanned: CountSchema,
  hosts_up: CountSchema,
  open_ports: CountSchema,
  services_identified: CountSchema,
  http_endpoints: CountSchema,
  tls_endpoints: CountSchema,
  technologies: CountSchema,
  observations: CountSchema,
  changes: z
    .record(ChangeStatusSchema, CountSchema)
    .nullable()
    .describe("Ports by change status; null without a previous scan"),
});

type Path = (string | number)[];

function flagDuplicates<T>(
  ctx: z.RefinementCtx,
  items: readonly T[],
  key: (item: T) => string,
  path: (item: T, index: number) => Path,
  message: string,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    const value = key(item);
    if (seen.has(value)) ctx.addIssue({ code: "custom", path: path(item, index), message });
    seen.add(value);
  });
}

export const ScanResultDocumentSchema = z
  .object({
    schema_version: z.literal(RESULT_SCHEMA_VERSION),
    generated_at: TimestampSchema,
    scan: ScanInfoSchema,
    summary: ResultSummarySchema,
    subnets: z.array(SubnetResultSchema),
  })
  .meta({
    title: "SubSurf scan result",
    description: "result.json: one scan run, nested subnet → host → port",
  })
  .superRefine((doc, ctx) => {
    flagDuplicates(
      ctx,
      doc.subnets,
      (subnet) => subnet.cidr,
      (_, s) => ["subnets", s, "cidr"],
      "Duplicate subnet",
    );
    flagDuplicates(
      ctx,
      doc.subnets.flatMap((subnet, s) => subnet.hosts.map((host, h) => ({ ip: host.ip, s, h }))),
      (entry) => entry.ip,
      ({ s, h }) => ["subnets", s, "hosts", h, "ip"],
      "Host already listed in this document",
    );

    doc.subnets.forEach((subnet, s) => {
      const cidr = parseCidr(subnet.cidr);
      if (intToIpv4(cidr.network) !== subnet.cidr.split("/")[0]) {
        const path = ["subnets", s, "cidr"];
        ctx.addIssue({ code: "custom", path, message: "Host bits must be zero" });
      }
      const range = cidrToRange(cidr);

      subnet.hosts.forEach((host, h) => {
        const hostPath: Path = ["subnets", s, "hosts", h];
        const ip = ipv4ToInt(host.ip);
        if (ip < range.start || ip > range.end) {
          const path = [...hostPath, "ip"];
          ctx.addIssue({ code: "custom", path, message: "Outside its subnet" });
        }
        flagDuplicates(
          ctx,
          host.ports,
          (port) => `${port.port}/${port.protocol}`,
          (_, p) => [...hostPath, "ports", p],
          "Duplicate port",
        );
        host.ports.forEach((port, p) =>
          flagDuplicates(
            ctx,
            port.endpoints,
            (endpoint) => endpoint.hostname ?? "",
            (_, e) => [...hostPath, "ports", p, "endpoints", e, "hostname"],
            "Duplicate endpoint hostname",
          ),
        );
      });
    });
  });

export type Evidence = z.infer<typeof EvidenceSchema>;
export type Detector = z.infer<typeof DetectorSchema>;
export type Technology = z.infer<typeof TechnologySchema>;
export type Observation = z.infer<typeof ObservationSchema>;
export type Interest = z.infer<typeof InterestSchema>;
export type ChangeStatus = z.infer<typeof ChangeStatusSchema>;
export type Diff = z.infer<typeof DiffSchema>;
export type Certificate = z.infer<typeof CertificateSchema>;
export type TlsInfo = z.infer<typeof TlsInfoSchema>;
export type Cookie = z.infer<typeof CookieSchema>;
export type HttpResponse = z.infer<typeof HttpResponseSchema>;
export type HttpInfo = z.infer<typeof HttpInfoSchema>;
export type Endpoint = z.infer<typeof EndpointSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type PortResult = z.infer<typeof PortResultSchema>;
export type HostResult = z.infer<typeof HostResultSchema>;
export type SubnetResult = z.infer<typeof SubnetResultSchema>;
export type ScanInfo = z.infer<typeof ScanInfoSchema>;
export type ScanResultDocument = z.infer<typeof ScanResultDocumentSchema>;
