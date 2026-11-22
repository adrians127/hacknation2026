import type { HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

const DEFAULT_PORT = { http: 80, https: 443 } as const;

/** `https://wiki.example.org`, or the bare IP, with the port when it is not the default. */
export function endpointLabel(
  endpoint: Pick<HttpEndpoint, "scheme" | "vhost">,
  ip: string,
  port: number,
): string {
  const host = endpoint.vhost ?? ip;
  return port === DEFAULT_PORT[endpoint.scheme]
    ? `${endpoint.scheme}://${host}`
    : `${endpoint.scheme}://${host}:${port}`;
}
