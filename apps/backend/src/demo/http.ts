import type { HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

import { fakeMmh3, fakeSha256 } from "~backend/demo/random";

type Cookie = HttpEndpoint["cookies"][number];
type Probe = HttpEndpoint["probes"][number];
type Redirect = HttpEndpoint["redirects"][number];
type Tls = NonNullable<HttpEndpoint["tls"]>;

/** The safe GET paths every job asks for (signature probes: presence only, no logins). */
export const PROBE_PATHS = [
  "/admin/",
  "/login",
  "/version",
  "/wp-login.php",
  "/manager/html",
  "/server-status",
] as const;

export type ProbePath = (typeof PROBE_PATHS)[number];

export interface ProbeSpec {
  statusCode: number;
  location?: string;
  title?: string | null;
  size?: number;
}

export interface CookieSpec {
  name: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: Cookie["sameSite"];
  path?: string;
  expires?: string;
}

/** What one web application answers on `/`. */
export interface SiteSpec {
  statusCode?: number;
  /** Where `/` redirects within the host, e.g. `/login`. */
  path?: string;
  redirectStatus?: number;
  title: string | null;
  /** Response headers in order, `content-type` and `date` excluded (added for every response). */
  headers?: readonly (readonly [string, string])[];
  cookies?: readonly CookieSpec[];
  html?: string;
  contentType?: string;
  /** A label shared by every install of the same software, so their favicon hashes match. */
  favicon?: string;
  probes?: Partial<Record<ProbePath, ProbeSpec>>;
}

export interface CertSpec {
  cn: string;
  san?: readonly string[];
  issuer: string;
  notBefore: string;
  notAfter: string;
  selfSigned?: boolean;
  keyAlgorithm?: "RSA" | "EC";
  keyBits?: number;
  tlsVersion?: "TLSv1.2" | "TLSv1.3";
}

export interface EndpointRequest {
  scheme: "http" | "https";
  ip: string;
  port: number;
  vhost: string | null;
  observedAt: string;
  /** Plain HTTP that sends every request to HTTPS on the same host first. */
  upgradesToHttps?: boolean;
  cert?: CertSpec;
}

const NOT_FOUND: ProbeSpec = { statusCode: 404, title: "404 Not Found", size: 153 };

export function certificate(spec: CertSpec): Tls["cert"] {
  const sha256 = fakeSha256(`cert ${spec.cn} ${spec.issuer} ${spec.notBefore}`);
  return {
    subjectCn: spec.cn,
    san: [...(spec.san ?? [spec.cn])],
    issuer: spec.selfSigned ? spec.cn : spec.issuer,
    notBefore: spec.notBefore,
    notAfter: spec.notAfter,
    serial: sha256.slice(0, 32),
    sha256,
    selfSigned: spec.selfSigned ?? false,
    keyAlgorithm: spec.keyAlgorithm ?? "RSA",
    keyBits: spec.keyBits ?? (spec.keyAlgorithm === "EC" ? 256 : 2048),
  };
}

function tls(spec: CertSpec): Tls {
  const version = spec.tlsVersion ?? "TLSv1.3";
  return {
    version,
    cipher: version === "TLSv1.3" ? "TLS_AES_256_GCM_SHA384" : "ECDHE-RSA-AES128-GCM-SHA256",
    alpn: version === "TLSv1.3" ? "h2" : "http/1.1",
    cert: certificate(spec),
  };
}

const escapeHtml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function page(title: string | null, body = "", head = ""): string {
  const titleTag = title === null ? "" : `<title>${escapeHtml(title)}</title>`;
  return (
    `<!doctype html><html><head><meta charset="utf-8">${titleTag}${head}</head>` +
    `<body>${body}</body></html>`
  );
}

/** RFC 7231 date, as servers send it. */
const httpDate = (iso: string) => new Date(iso).toUTCString();

function probe(origin: string, path: ProbePath, spec: ProbeSpec = NOT_FOUND): Probe {
  const size = spec.size ?? (spec.statusCode >= 300 && spec.statusCode < 400 ? 0 : 512);
  return {
    path,
    statusCode: spec.statusCode,
    location: spec.location ?? null,
    title: spec.title ?? null,
    size,
    bodySha256: size === 0 ? null : fakeSha256(`probe ${origin}${path} ${spec.statusCode}`),
    error: null,
  };
}

function cookie(spec: CookieSpec, host: string, observedAt: string): Cookie {
  return {
    name: spec.name,
    // Session values differ on every request; only their hash leaves the worker.
    valueSha256: fakeSha256(`cookie ${spec.name} ${host} ${observedAt}`),
    secure: spec.secure ?? false,
    httpOnly: spec.httpOnly ?? false,
    sameSite: spec.sameSite ?? null,
    domain: null,
    path: spec.path ?? "/",
    expires: spec.expires ?? null,
  };
}

/** One `http[]` entry of the worker result: the request to `/` and the job's probe paths. */
export function endpoint(request: EndpointRequest, site: SiteSpec): HttpEndpoint {
  const host = request.vhost ?? request.ip;
  const defaultPort = request.scheme === "https" ? 443 : 80;
  const origin = `${request.scheme}://${host}${request.port === defaultPort ? "" : `:${request.port}`}`;
  const url = `${origin}/`;

  const redirects: Redirect[] = [];
  let finalOrigin = origin;
  if (request.upgradesToHttps) {
    finalOrigin = `https://${host}`;
    redirects.push({ url, statusCode: 301, location: `${finalOrigin}/`, followed: true });
  }
  if (site.path) {
    redirects.push({
      url: `${finalOrigin}/`,
      statusCode: site.redirectStatus ?? 302,
      location: site.path,
      followed: true,
    });
  }

  const html = site.html ?? page(site.title);
  const contentType = site.contentType ?? "text/html; charset=utf-8";
  const headers = [
    ...(site.headers ?? []),
    ["content-type", contentType] as const,
    ["date", httpDate(request.observedAt)] as const,
  ].map(([name, value]) => ({ name: name.toLowerCase(), value }));

  return {
    scheme: request.scheme,
    vhost: request.vhost,
    url,
    finalUrl: `${finalOrigin}${site.path ?? "/"}`,
    statusCode: site.statusCode ?? 200,
    title: site.title,
    headers,
    cookies: (site.cookies ?? []).map((spec) => cookie(spec, host, request.observedAt)),
    redirects,
    body: {
      sha256: fakeSha256(html),
      size: Buffer.byteLength(html),
      contentType,
      content: html,
      truncated: false,
    },
    favicon: site.favicon
      ? {
          url: `${finalOrigin}/favicon.ico`,
          mmh3: fakeMmh3(`favicon ${site.favicon}`),
          sha256: fakeSha256(`favicon ${site.favicon}`),
        }
      : null,
    tls: request.scheme === "https" && request.cert ? tls(request.cert) : null,
    probes: PROBE_PATHS.map((path) => probe(finalOrigin, path, site.probes?.[path])),
    error: null,
  };
}

/** Requests sent for one endpoint: `/`, followed redirects, probes and the favicon. */
export function requestCount(entry: HttpEndpoint): number {
  const followed = entry.redirects.filter((redirect) => redirect.followed).length;
  return 1 + followed + entry.probes.length + (entry.favicon ? 1 : 0);
}
