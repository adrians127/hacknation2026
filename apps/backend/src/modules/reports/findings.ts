import type {
  Finding,
  FindingRule,
  FindingSeverity,
  PrioritizedHost,
  SeverityCounts,
} from "@subsurf/contracts/reports/reports.schema";
import type { HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

import { headerValues, type ReportHost, type ReportService } from "~backend/modules/reports/report-data";

export const RULE_SEVERITY: Record<FindingRule, FindingSeverity> = {
  "database-exposed": "high",
  "debug-or-staging": "high",
  "tls-expired": "high",
  "admin-panel": "medium",
  "cleartext-protocol": "medium",
  "directory-listing": "medium",
  "tls-expiring": "medium",
  "tls-weak": "medium",
  "outdated-software": "medium",
  "remote-access": "low",
  "tls-self-signed": "low",
  "cookie-insecure": "low",
  "cors-wildcard": "low",
  "default-page": "low",
  "missing-security-headers": "info",
  "version-disclosure": "info",
};

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = { high: 10, medium: 5, low: 2, info: 0.5 };
const NEW_SERVICE_BONUS = 3;
const IMPORTANT_MULTIPLIER = 1.5;
const EXPIRING_DAYS = 30;
const DAY_MS = 86_400_000;
const MAX_EVIDENCE = 3;

const DATABASE_PORTS = new Map<number, string>([
  [1433, "Microsoft SQL Server"],
  [1521, "Oracle"],
  [3306, "MySQL"],
  [5432, "PostgreSQL"],
  [5984, "CouchDB"],
  [6379, "Redis"],
  [9042, "Cassandra"],
  [9200, "Elasticsearch"],
  [11211, "Memcached"],
  [27017, "MongoDB"],
]);
const DATABASE_SERVICES = new Set([
  "mysql",
  "postgresql",
  "ms-sql-s",
  "oracle-tns",
  "mongodb",
  "mongod",
  "redis",
  "memcached",
  "couchdb",
  "cassandra",
  "elasticsearch",
]);
const CLEARTEXT_SERVICES = new Map([
  ["ftp", "FTP"],
  ["telnet", "Telnet"],
  ["login", "rlogin"],
  ["shell", "rsh"],
  ["exec", "rexec"],
]);
const REMOTE_ACCESS = new Map<number, string>([
  [445, "SMB"],
  [3389, "RDP"],
  [5900, "VNC"],
  [5901, "VNC"],
  [5985, "WinRM"],
  [5986, "WinRM"],
]);
const REMOTE_ACCESS_SERVICES = new Map([
  ["ms-wbt-server", "RDP"],
  ["vnc", "VNC"],
  ["microsoft-ds", "SMB"],
]);

const ADMIN_TITLES: readonly RegExp[] = [
  /phpmyadmin/i,
  /\[jenkins\]/i,
  /^grafana$/i,
  /^zabbix/i,
  /gitlab/i,
  /^elastic$|kibana/i,
  /routeros|mikrotik/i,
  /idrac|ilo\b|integrated lights-out/i,
  /synology diskstation/i,
  /webmin|portainer|pfsense|proxmox|cpanel|plesk/i,
  /\badmin(istration|istrator)?\b|panel administracyjny/i,
];
const ADMIN_PROBES: ReadonlyMap<string, readonly number[]> = new Map([
  ["/manager/html", [200, 401, 403]],
  ["/wp-login.php", [200]],
  ["/administrator/", [200]],
  ["/phpmyadmin/", [200, 401]],
]);
const DEBUG_TITLES: readonly RegExp[] = [
  /page not found at \//i,
  /disallowedhost|traceback|stack trace|whoops!|phpinfo\(\)/i,
  /swagger ui|api documentation|graphiql/i,
  /\[staging\]|\bstaging\b/i,
];
const DEFAULT_TITLES: readonly RegExp[] = [
  /^welcome to nginx!?$/i,
  /apache2 (ubuntu|debian) default page/i,
  /^iis windows server$/i,
  /test page for the (apache|nginx)/i,
  /^it works!?$/i,
];
const LOGIN_TITLES = /log ?in|sign ?in|logowanie|zaloguj|log on|anmelden/i;
const SESSION_COOKIE = /sess|sid|token|auth|login|csrf/i;
const WEAK_TLS = new Set(["SSLv3", "TLSv1", "TLSv1.0", "TLSv1.1"]);

/** Software and the first version still supported; anything older is reported. */
const OUTDATED: readonly { pattern: RegExp; minimum: number[]; label: string }[] = [
  { pattern: /\bphp\/(\d+(?:\.\d+)*)/i, minimum: [8, 2], label: "PHP" },
  { pattern: /\bapache\/(\d+(?:\.\d+)*)/i, minimum: [2, 4, 50], label: "Apache httpd" },
  { pattern: /\bmicrosoft-iis\/(\d+(?:\.\d+)*)/i, minimum: [8, 5], label: "IIS" },
  { pattern: /\bapache tomcat\/(\d+(?:\.\d+)*)/i, minimum: [9], label: "Apache Tomcat" },
  { pattern: /joomla!?[^\d]*(\d+(?:\.\d+)*)/i, minimum: [4], label: "Joomla!" },
  { pattern: /\bdrupal (\d+(?:\.\d+)*)/i, minimum: [10], label: "Drupal" },
  { pattern: /\bwordpress (\d+(?:\.\d+)*)/i, minimum: [6], label: "WordPress" },
  { pattern: /\bmysql (\d+(?:\.\d+)*)/i, minimum: [8], label: "MySQL" },
];

function versionBelow(version: string, minimum: readonly number[]): boolean {
  const parts = version.split(".").map(Number);
  for (const [index, required] of minimum.entries()) {
    const part = parts[index] ?? 0;
    if (part !== required) return part < required;
  }
  return false;
}

const isHtml = (endpoint: HttpEndpoint) => endpoint.body?.contentType?.toLowerCase().includes("html") ?? false;
const isSuccess = (endpoint: HttpEndpoint) =>
  endpoint.statusCode !== null && endpoint.statusCode >= 200 && endpoint.statusCode < 300;

function label(service: ReportService): string {
  const { product, version, name } = service.identity;
  return product ? [product, version].filter(Boolean).join(" ") : (name ?? "unknown service");
}

type Hit = [FindingRule, string];

function portHits(service: ReportService): Hit[] {
  const hits: Hit[] = [];
  const name = service.identity.name?.toLowerCase() ?? "";
  const where = `${label(service)} on ${service.port}/tcp`;
  if (DATABASE_SERVICES.has(name) || DATABASE_PORTS.has(service.port)) {
    hits.push(["database-exposed", DATABASE_PORTS.has(service.port) && !DATABASE_SERVICES.has(name) ? `${DATABASE_PORTS.get(service.port)} port ${service.port}/tcp open` : where]);
  }
  const cleartext = CLEARTEXT_SERVICES.get(name);
  if (cleartext) hits.push(["cleartext-protocol", `${cleartext}: ${where}`]);
  const remote = REMOTE_ACCESS_SERVICES.get(name) ?? REMOTE_ACCESS.get(service.port);
  if (remote) hits.push(["remote-access", `${remote}: ${where}`]);

  const software = [
    [service.identity.product, service.identity.version].filter(Boolean).join(" "),
    ...service.details.http.flatMap((endpoint) => [
      ...headerValues(endpoint, "server"),
      ...headerValues(endpoint, "x-powered-by"),
      ...headerValues(endpoint, "x-generator"),
      endpoint.title ?? "",
      ...generators(endpoint),
    ]),
  ];
  for (const rule of OUTDATED) {
    for (const text of software) {
      const version = rule.pattern.exec(text)?.[1];
      if (version && versionBelow(version, rule.minimum)) {
        hits.push(["outdated-software", `${rule.label} ${version} (older than ${rule.minimum.join(".")})`]);
        break;
      }
    }
  }
  return hits;
}

const GENERATOR = /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]*name=["']generator["']/gi;

export function generators(endpoint: HttpEndpoint): string[] {
  const content = endpoint.body?.content;
  if (!content) return [];
  return [...content.matchAll(GENERATOR)].flatMap((match) => {
    const value = match[1] ?? match[2];
    return value ? [value] : [];
  });
}

function endpointHits(endpoint: HttpEndpoint, now: Date): Hit[] {
  const hits: Hit[] = [];
  const title = endpoint.title ?? "";
  const at = endpoint.url;

  if (title && ADMIN_TITLES.some((pattern) => pattern.test(title))) hits.push(["admin-panel", `"${title}" at ${at}`]);
  for (const probe of endpoint.probes) {
    const statuses = ADMIN_PROBES.get(probe.path);
    if (statuses && probe.statusCode !== null && statuses.includes(probe.statusCode)) {
      hits.push(["admin-panel", `${probe.path} answers ${probe.statusCode} at ${at}`]);
    }
    if (probe.path === "/server-status" && probe.statusCode === 200) {
      hits.push(["debug-or-staging", `/server-status is public at ${at}`]);
    }
  }
  const realm = headerValues(endpoint, "www-authenticate").find((value) => /level_15|admin/i.test(value));
  if (realm) hits.push(["admin-panel", `www-authenticate: ${realm} at ${at}`]);

  if (title && DEBUG_TITLES.some((pattern) => pattern.test(title))) hits.push(["debug-or-staging", `"${title}" at ${at}`]);
  for (const value of headerValues(endpoint, "x-environment")) {
    if (/stag|dev|test|uat|qa/i.test(value)) hits.push(["debug-or-staging", `x-environment: ${value} at ${at}`]);
  }
  for (const header of endpoint.headers) {
    if (/^x-debug/i.test(header.name)) hits.push(["debug-or-staging", `${header.name}: ${header.value} at ${at}`]);
  }

  if (/^(index of \/|directory listing for)/i.test(title)) hits.push(["directory-listing", `"${title}" at ${at}`]);
  if (title && DEFAULT_TITLES.some((pattern) => pattern.test(title))) hits.push(["default-page", `"${title}" at ${at}`]);

  const loginPage =
    (title && LOGIN_TITLES.test(title)) ||
    endpoint.probes.some((probe) => probe.path === "/login" && probe.statusCode === 200);
  if (endpoint.scheme === "http" && loginPage && !endpoint.finalUrl.startsWith("https:")) {
    hits.push(["cleartext-protocol", `login page over plain HTTP at ${at}`]);
  }

  const tls = endpoint.tls;
  if (tls) {
    const { cert } = tls;
    const notAfter = new Date(cert.notAfter);
    if (notAfter < now) {
      hits.push(["tls-expired", `certificate ${cert.subjectCn ?? "—"} expired ${cert.notAfter.slice(0, 10)}`]);
    } else if (notAfter.getTime() - now.getTime() < EXPIRING_DAYS * DAY_MS) {
      hits.push(["tls-expiring", `certificate ${cert.subjectCn ?? "—"} expires ${cert.notAfter.slice(0, 10)}`]);
    }
    if (cert.selfSigned) hits.push(["tls-self-signed", `self-signed certificate ${cert.subjectCn ?? "—"}`]);
    if (WEAK_TLS.has(tls.version)) hits.push(["tls-weak", `${tls.version} negotiated`]);
    if (/rsa/i.test(cert.keyAlgorithm) && cert.keyBits !== null && cert.keyBits < 2048) {
      hits.push(["tls-weak", `RSA key of ${cert.keyBits} bits`]);
    }
  }

  for (const cookie of endpoint.cookies) {
    const missing = [
      endpoint.scheme === "https" && !cookie.secure ? "Secure" : null,
      SESSION_COOKIE.test(cookie.name) && !cookie.httpOnly ? "HttpOnly" : null,
      cookie.sameSite === "None" && !cookie.secure ? "Secure with SameSite=None" : null,
    ].filter((flag) => flag !== null);
    if (missing.length > 0) hits.push(["cookie-insecure", `${cookie.name} without ${[...new Set(missing)].join(", ")}`]);
  }

  if (headerValues(endpoint, "access-control-allow-origin").includes("*")) {
    hits.push(["cors-wildcard", `access-control-allow-origin: * at ${at}`]);
  }

  if (isSuccess(endpoint) && isHtml(endpoint)) {
    const has = (name: string) => headerValues(endpoint, name).length > 0;
    const missing = [
      endpoint.scheme === "https" && !has("strict-transport-security") ? "strict-transport-security" : null,
      !has("content-security-policy") ? "content-security-policy" : null,
      !has("x-frame-options") && !has("content-security-policy") ? "x-frame-options" : null,
      !has("x-content-type-options") ? "x-content-type-options" : null,
    ].filter((header) => header !== null);
    if (missing.length > 0) hits.push(["missing-security-headers", `${missing.join(", ")} at ${at}`]);
  }

  for (const name of ["server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version"]) {
    for (const value of headerValues(endpoint, name)) {
      if (/\d+\.\d+/.test(value)) hits.push(["version-disclosure", `${name}: ${value}`]);
    }
  }
  return hits;
}

/** One finding per rule and service; evidence from several endpoints is joined. */
export function findingsFor(service: ReportService, now: Date): Finding[] {
  const hits = [...portHits(service), ...service.details.http.flatMap((endpoint) => endpointHits(endpoint, now))];
  const byRule = new Map<FindingRule, string[]>();
  for (const [rule, evidence] of hits) {
    const list = byRule.get(rule) ?? [];
    if (!list.includes(evidence)) list.push(evidence);
    byRule.set(rule, list);
  }
  return [...byRule].map(([rule, evidence]) => ({
    rule,
    severity: RULE_SEVERITY[rule],
    hostId: service.hostId,
    serviceId: service.serviceId,
    ip: service.ip,
    port: service.port,
    evidence:
      evidence.slice(0, MAX_EVIDENCE).join("; ") +
      (evidence.length > MAX_EVIDENCE ? ` (+${evidence.length - MAX_EVIDENCE})` : ""),
  }));
}

export const EMPTY_SEVERITY_COUNTS = (): SeverityCounts => ({ high: 0, medium: 0, low: 0, info: 0 });

export function countSeverities(findings: readonly Finding[]): SeverityCounts {
  const counts = EMPTY_SEVERITY_COUNTS();
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };

export const bySeverity = (a: Finding, b: Finding) =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.port - b.port;

/** Hosts of the scan with their findings and priority score; false positives left out. */
export function prioritize(hosts: readonly ReportHost[], now: Date): PrioritizedHost[] {
  return hosts
    .filter((host) => host.status === "up" && host.triage !== "false_positive")
    .map((host) => {
      const services = host.services.filter((service) => service.present && service.triage !== "false_positive");
      const findings = services.flatMap((service) => findingsFor(service, now)).toSorted(bySeverity);
      const newServices = host.change === "new" ? 1 : services.filter((service) => service.change === "new").length;
      const base =
        findings.reduce((sum, finding) => sum + SEVERITY_WEIGHT[finding.severity], 0) +
        (findings.length > 0 ? newServices * NEW_SERVICE_BONUS : 0);
      const important = host.triage === "important" || services.some((service) => service.triage === "important");
      return {
        hostId: host.hostId,
        ip: host.ip,
        hostnames: host.hostnames,
        score: Math.round((important ? base * IMPORTANT_MULTIPLIER : base) * 10) / 10,
        change: host.change,
        triage: host.triage,
        tags: host.tags,
        findings,
      };
    })
    .filter((host) => host.findings.length > 0)
    .toSorted((a, b) => b.score - a.score || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}
