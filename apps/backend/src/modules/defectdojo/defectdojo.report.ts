import type { ServiceIdentity, TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";
import type { DetectionSummary, SignatureSeverity } from "@subsurf/contracts/signatures/detection.schema";
import type { HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

/** A service as the push describes it: the user's corrections already applied. */
export interface ExportService {
  ip: string;
  hostnames: string[];
  port: number;
  identity: ServiceIdentity;
  extraInfo: string | null;
  cpe: string[];
  http: HttpEndpoint[];
  triage: TriageStatus;
  tags: string[];
  note: string;
  /** What detection signatures matched the port in the pushed scan. */
  detections: DetectionSummary[];
}

/** Only the parser's allow-list (dojo/tools/generic/json_parser.py): any other key fails the import. */
export interface GenericFinding {
  title: string;
  severity: "Info" | "Low" | "Medium" | "High";
  description: string;
  date: string;
  unique_id_from_tool: string;
  endpoints: string[];
  tags: string[];
  active: boolean;
  verified: boolean;
  false_p: boolean;
  dynamic_finding: true;
  static_finding: false;
  mitigation: string;
  component_name?: string;
  component_version?: string;
  impact?: string;
}

export interface GenericReport {
  name: string;
  type: string;
  version: string;
  findings: GenericFinding[];
}

// Headers that name software; others vary per request and would change the description.
const SOFTWARE_HEADERS = new Set(["server", "x-powered-by", "x-generator", "x-aspnet-version"]);

const MITIGATION =
  "Informational observation from SubSurf discovery (no exploitation, no login attempts). " +
  "Confirm the service is expected on this host; otherwise close it or restrict who can reach it.";

/** DefectDojo splits tags on spaces and commas. */
const dojoTag = (tag: string) => tag.trim().replaceAll(/[\s,"]+/g, "-");

// The location's protocol column is varchar(10): `ms-wbt-server` fails the whole import (HTTP 500).
const MAX_SCHEME_LENGTH = 10;

const urlScheme = (name: string | null) => {
  const scheme = name?.toLowerCase().replaceAll(/[^a-z0-9+.-]/g, "");
  return scheme && /^[a-z]/.test(scheme) && scheme.length <= MAX_SCHEME_LENGTH ? scheme : "tcp";
};

function label({ name, product, version }: ServiceIdentity): string {
  if (product) return version ? `${product} ${version}` : product;
  return name ?? "unknown service";
}

function httpLine(endpoint: HttpEndpoint): string {
  const software = endpoint.headers
    .filter((header) => SOFTWARE_HEADERS.has(header.name.toLowerCase()))
    .map((header) => `${header.name}: ${header.value}`);
  const parts = [
    `${endpoint.url} → ${endpoint.statusCode ?? "no response"}`,
    endpoint.title ? `"${endpoint.title}"` : null,
    endpoint.finalUrl !== endpoint.url ? `final ${endpoint.finalUrl}` : null,
    software.length > 0 ? `(${software.join("; ")})` : null,
  ];
  const lines = [`- HTTP: ${parts.filter(Boolean).join(" ")}`];
  const cert = endpoint.tls?.cert;
  if (endpoint.tls && cert) {
    lines.push(
      `- TLS ${endpoint.tls.version}: CN=${cert.subjectCn ?? "—"}, issuer ${cert.issuer ?? "—"}, ` +
        `valid until ${cert.notAfter.slice(0, 10)}${cert.selfSigned ? ", self-signed" : ""}`,
    );
  }
  return lines.join("\n");
}

/**
 * The description is part of DefectDojo's dedup hash for this format (title + cwe +
 * description), so it starts with `ip:port/tcp` and holds only what the scan fingerprint
 * covers: a changed service becomes a new finding and the old one is closed. The user's
 * note goes to `impact`, outside the hash.
 */
function description(service: ExportService): string {
  const lines = [`${service.ip}:${service.port}/tcp. ${label(service.identity)}.`];
  if (service.hostnames.length > 0) lines.push(`- Hostnames: ${service.hostnames.join(", ")}`);
  if (service.identity.name) lines.push(`- Service: ${service.identity.name}`);
  if (service.extraInfo) lines.push(`- Extra info: ${service.extraInfo}`);
  if (service.cpe.length > 0) lines.push(`- CPE: ${service.cpe.join(", ")}`);
  lines.push(...service.http.map(httpLine));
  return lines.join("\n");
}

function endpoints(service: ExportService): string[] {
  const urls = service.http.map((endpoint) => endpoint.url);
  return urls.length > 0 ? [...new Set(urls)] : [`${urlScheme(service.identity.name)}://${service.ip}:${service.port}`];
}

export function toGenericFinding(service: ExportService, scanDate: string): GenericFinding {
  const { product, version } = service.identity;
  const falsePositive = service.triage === "false_positive";
  return {
    title: `Exposed ${label(service.identity)} on ${service.port}/tcp`,
    severity: "Info",
    description: description(service),
    date: scanDate,
    // The pull (defectdojo.import.ts) matches findings back to services by this id.
    unique_id_from_tool: `subsurf:${service.ip}:${service.port}:service`,
    endpoints: endpoints(service),
    tags: [...new Set(["subsurf", ...service.tags.map(dojoTag).filter(Boolean)])],
    active: !falsePositive,
    verified: service.triage === "important",
    false_p: falsePositive,
    dynamic_finding: true,
    static_finding: false,
    mitigation: MITIGATION,
    ...(product && { component_name: product }),
    ...(product && version && { component_version: version }),
    ...(service.note && { impact: `Analyst note (SubSurf): ${service.note}` }),
  };
}

const DOJO_SEVERITY: Record<SignatureSeverity, GenericFinding["severity"]> = {
  info: "Info",
  low: "Low",
  medium: "Medium",
  high: "High",
};

/**
 * A detection signature with a severity, as its own finding. The description (dedup hash) holds
 * only what identifies it; the version goes to `component_version`, outside the hash.
 */
export function toDetectionFinding(
  service: ExportService,
  detection: DetectionSummary & { severity: SignatureSeverity },
  scanDate: string,
): GenericFinding {
  const id = (detection.key ?? detection.signatureId).replaceAll(/[^A-Za-z0-9._-]/g, "-");
  const falsePositive = service.triage === "false_positive";
  return {
    title: `${detection.name} on ${service.ip}:${service.port}/tcp`,
    severity: DOJO_SEVERITY[detection.severity],
    description: `${service.ip}:${service.port}/tcp. Detection signature "${detection.name}" (${id}, ${detection.category}).`,
    date: scanDate,
    unique_id_from_tool: `subsurf:${service.ip}:${service.port}:detection:${id}`,
    endpoints: endpoints(service),
    tags: [...new Set(["subsurf", "subsurf-detection", ...service.tags.map(dojoTag).filter(Boolean)])],
    active: !falsePositive,
    verified: false,
    false_p: falsePositive,
    dynamic_finding: true,
    static_finding: false,
    mitigation: MITIGATION,
    ...(detection.product && { component_name: detection.product }),
    ...(detection.product && detection.version && { component_version: detection.version }),
    impact: `Matched by a SubSurf detection signature (${detection.confidence} confidence); safe detection only.`,
  };
}

export function buildReport(services: readonly ExportService[], scanDate: string, version: string): GenericReport {
  return {
    name: "SubSurf",
    type: "SubSurf discovery",
    version,
    findings: services.flatMap((service) => [
      toGenericFinding(service, scanDate),
      ...service.detections.flatMap((detection) =>
        detection.severity === null
          ? []
          : [toDetectionFinding(service, { ...detection, severity: detection.severity }, scanDate)],
      ),
    ]),
  };
}
