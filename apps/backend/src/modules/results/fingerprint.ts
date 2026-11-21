import { createHash } from "node:crypto";

import type { HttpEndpoint, OpenPort } from "@subsurf/contracts/workers/worker-result.schema";

// Headers that name software and its version. Everything else (Date, ETag, request ids,
// cookie values, body hashes) changes between requests and would mark every page "changed".
const STABLE_HEADERS = new Set(["server", "x-powered-by", "x-generator", "x-aspnet-version"]);

/** SHA-256 over what makes a port "changed" between two scans. */
export function portFingerprint(port: OpenPort): string {
  const stable = {
    protocol: port.protocol,
    port: port.port,
    service: port.service && {
      name: port.service.name,
      product: port.service.product,
      version: port.service.version,
      extraInfo: port.service.extraInfo,
      cpe: port.service.cpe.toSorted(),
    },
    http: port.http
      .map(stableEndpoint)
      .toSorted((a, b) => a.key.localeCompare(b.key)),
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function stableEndpoint(endpoint: HttpEndpoint) {
  return {
    key: `${endpoint.scheme} ${endpoint.vhost ?? ""}`,
    statusCode: endpoint.statusCode,
    title: endpoint.title,
    // Path only: query strings and `;jsessionid=` differ per request.
    finalPath: new URL(endpoint.finalUrl).pathname.split(";")[0],
    headers: endpoint.headers
      .filter((header) => STABLE_HEADERS.has(header.name.toLowerCase()))
      .map((header) => `${header.name.toLowerCase()}: ${header.value}`)
      .toSorted(),
    certSha256: endpoint.tls?.cert.sha256 ?? null,
    faviconSha256: endpoint.favicon?.sha256 ?? null,
  };
}
