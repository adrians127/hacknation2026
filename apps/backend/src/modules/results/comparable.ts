import { SECURITY_HEADERS, TECHNOLOGY_HEADERS } from "@subsurf/contracts/scans/compared-fields";
import type { HttpEndpoint, OpenPort } from "@subsurf/contracts/workers/worker-result.schema";

/**
 * What makes a port "changed" between two scans. The fingerprint hashes this view and the
 * field-level diff compares it, so the two cannot disagree.
 *
 * Left out on purpose: everything that differs between two requests to the same page (Date,
 * ETag, request ids, cookie values and expiry, body hashes, query strings), and the banner and
 * script output, which often carry timestamps. The compared headers are in the contracts, so
 * the UI shows the same ones.
 */

const TECHNOLOGY: ReadonlySet<string> = new Set(TECHNOLOGY_HEADERS);
const SECURITY: ReadonlySet<string> = new Set(SECURITY_HEADERS);

export interface ComparableCert {
  sha256: string;
  issuer: string | null;
  /** `yyyy-mm-dd` */
  expiresOn: string;
  selfSigned: boolean;
}

export interface ComparableEndpoint {
  scheme: HttpEndpoint["scheme"];
  vhost: string | null;
  url: string;
  statusCode: number | null;
  title: string | null;
  finalPath: string;
  /** Technology headers by lowercase name; repeated headers joined with ", ". */
  headers: Record<string, string>;
  /** Present security headers, lowercase, with their (display-only) values. */
  securityHeaders: Record<string, string>;
  /** Cookie flags by cookie name, e.g. `Secure, HttpOnly, SameSite=Lax`. */
  cookies: Record<string, string>;
  cert: ComparableCert | null;
  tlsVersion: string | null;
  favicon: { sha256: string; mmh3: number } | null;
  /** Probe path to status code (`null`: no response). */
  probes: Record<string, number | null>;
}

export interface ComparablePort {
  protocol: OpenPort["protocol"];
  port: number;
  service: {
    name: string | null;
    product: string | null;
    version: string | null;
    extraInfo: string | null;
    cpe: string[];
  } | null;
  sshHostKey: string | null;
  /** Sorted by `endpointKey`. */
  http: ComparableEndpoint[];
}

export const endpointKey = (endpoint: Pick<ComparableEndpoint, "scheme" | "vhost">) =>
  `${endpoint.scheme} ${endpoint.vhost ?? ""}`;

const sortedRecord = <T>(entries: Iterable<[string, T]>): Record<string, T> =>
  Object.fromEntries([...entries].toSorted(([a], [b]) => a.localeCompare(b)));

function headerGroup(endpoint: HttpEndpoint, names: ReadonlySet<string>): Record<string, string> {
  const values = new Map<string, string[]>();
  for (const header of endpoint.headers) {
    const name = header.name.toLowerCase();
    if (names.has(name)) values.set(name, [...(values.get(name) ?? []), header.value]);
  }
  return sortedRecord([...values].map(([name, list]) => [name, list.join(", ")]));
}

function cookieFlags(cookie: HttpEndpoint["cookies"][number]): string {
  return [
    cookie.secure ? "Secure" : null,
    cookie.httpOnly ? "HttpOnly" : null,
    cookie.sameSite ? `SameSite=${cookie.sameSite}` : null,
  ]
    .filter((flag) => flag !== null)
    .join(", ");
}

function comparableEndpoint(endpoint: HttpEndpoint): ComparableEndpoint {
  const cert = endpoint.tls?.cert ?? null;
  return {
    scheme: endpoint.scheme,
    vhost: endpoint.vhost,
    url: endpoint.url,
    statusCode: endpoint.statusCode,
    title: endpoint.title,
    // Path only: query strings and `;jsessionid=` differ per request.
    finalPath: new URL(endpoint.finalUrl).pathname.split(";")[0] ?? "/",
    headers: headerGroup(endpoint, TECHNOLOGY),
    securityHeaders: headerGroup(endpoint, SECURITY),
    cookies: sortedRecord(endpoint.cookies.map((cookie) => [cookie.name, cookieFlags(cookie)])),
    cert: cert && {
      sha256: cert.sha256,
      issuer: cert.issuer,
      expiresOn: cert.notAfter.slice(0, 10),
      selfSigned: cert.selfSigned,
    },
    tlsVersion: endpoint.tls?.version ?? null,
    favicon: endpoint.favicon && { sha256: endpoint.favicon.sha256, mmh3: endpoint.favicon.mmh3 },
    probes: sortedRecord(endpoint.probes.map((probe) => [probe.path, probe.statusCode])),
  };
}

export function comparablePort(port: OpenPort): ComparablePort {
  return {
    protocol: port.protocol,
    port: port.port,
    service: port.service && {
      name: port.service.name,
      product: port.service.product,
      version: port.service.version,
      extraInfo: port.service.extraInfo,
      cpe: port.service.cpe.toSorted(),
    },
    sshHostKey: port.identity.sshHostKeySha256,
    http: port.http
      .map(comparableEndpoint)
      .toSorted((a, b) => endpointKey(a).localeCompare(endpointKey(b))),
  };
}

/** The view without display-only values, for hashing. */
export function hashedView(port: ComparablePort) {
  return {
    ...port,
    http: port.http.map(({ url: _url, securityHeaders, favicon, ...endpoint }) => ({
      ...endpoint,
      securityHeaders: Object.keys(securityHeaders),
      favicon: favicon?.sha256 ?? null,
    })),
  };
}
