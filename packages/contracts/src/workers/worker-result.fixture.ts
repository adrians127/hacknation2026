import type { HttpEndpoint, WorkerResult } from "./worker-result.schema";

/** Test helper: the example from docs/worker-result-format.md, with real-looking hashes. */

const hash = (char: string) => char.repeat(64);

export const EXAMPLE_IDS = {
  scanId: "0193a000-0000-7000-8000-000000000000",
  jobId: "0193a000-0000-7000-8000-000000000001",
  leaseId: "lease-0001",
} as const;

export interface WorkerResultIds {
  scanId: string;
  jobId: string;
  leaseId: string;
}

const wikiEndpoint: HttpEndpoint = {
  scheme: "https",
  vhost: "wiki.example.org",
  url: "https://wiki.example.org/",
  finalUrl: "https://wiki.example.org/login",
  statusCode: 200,
  title: "Wiki – login",
  headers: [
    { name: "server", value: "nginx/1.24.0" },
    { name: "x-powered-by", value: "PHP/8.1.2" },
  ],
  cookies: [
    {
      name: "PHPSESSID",
      valueSha256: hash("c"),
      secure: true,
      httpOnly: false,
      sameSite: null,
      domain: null,
      path: "/",
      expires: null,
    },
  ],
  redirects: [
    { url: "https://wiki.example.org/", statusCode: 302, location: "/login", followed: true },
  ],
  body: {
    sha256: hash("b"),
    size: 18342,
    contentType: "text/html",
    content: '<!doctype html><title>Wiki – login</title><link href="/wp-content/x.css">',
    truncated: false,
  },
  favicon: { url: "https://wiki.example.org/favicon.ico", mmh3: -1137954245, sha256: hash("f") },
  tls: {
    version: "TLSv1.3",
    cipher: "TLS_AES_256_GCM_SHA384",
    alpn: "h2",
    cert: {
      subjectCn: "wiki.example.org",
      san: ["wiki.example.org"],
      issuer: "R11",
      notBefore: "2026-09-01T00:00:00Z",
      notAfter: "2026-11-30T00:00:00Z",
      serial: "04a1b2c3",
      sha256: hash("e"),
      selfSigned: false,
      keyAlgorithm: "RSA",
      keyBits: 2048,
    },
  },
  probes: [
    {
      path: "/wp-admin/",
      statusCode: 302,
      location: "/wp-login.php",
      title: null,
      size: 0,
      bodySha256: null,
      error: null,
    },
  ],
  error: null,
};

const bareIpEndpoint: HttpEndpoint = {
  ...wikiEndpoint,
  vhost: null,
  url: "https://10.0.5.7/",
  finalUrl: "https://10.0.5.7/",
  statusCode: 404,
  title: null,
  cookies: [],
  redirects: [],
  body: { sha256: hash("d"), size: 153, contentType: "text/html", content: "Not Found", truncated: false },
  favicon: null,
  probes: [],
};

/** A fresh deep copy on every call, so tests can mutate it. */
export function buildWorkerResult(ids: WorkerResultIds = EXAMPLE_IDS): WorkerResult {
  return structuredClone({
    scan: {
      ...ids,
      worker: { id: "nmap-worker-1", version: "0.3.0", nmapVersion: "7.95" },
      status: "partial",
      stopReason: "deadline",
      startedAt: "2026-11-21T14:00:02Z",
      finishedAt: "2026-11-21T14:15:14Z",
      durationMs: 912000,
      phasesMs: { hostDiscovery: 41000, portScan: 610000, serviceDetection: 190000, http: 71000 },
      params: {
        subnet: "10.0.5.0/24",
        ports: "21-23,80,443,8000-8100",
        maxParallel: 4,
        maxRatePerProcess: 300,
        hostTimeoutMs: 300000,
        httpTimeoutMs: 10000,
        maxBodyBytes: 524288,
        maxRedirects: 5,
        nmapArgs: ["-sS", "-sV", "--max-rate", "300", "-p", "21-23,80,443,8000-8100", "-oX", "-"],
      },
      counts: {
        addresses: 4,
        up: 1,
        down: 1,
        timeout: 1,
        cancelled: 1,
        failed: 0,
        openPorts: 2,
        httpEndpoints: 2,
        httpRequests: 6,
      },
      error: null,
    },
    hosts: [
      {
        ip: "10.0.5.7",
        status: "up",
        reason: "syn-ack",
        observedAt: "2026-11-21T14:03:11Z",
        latencyMs: 3,
        hostnames: [
          { name: "wiki.example.org", source: "job" },
          { name: "web01.example.org", source: "ptr" },
          { name: "wiki.example.org", source: "tls-san" },
        ],
        error: null,
        ports: [
          {
            port: 22,
            protocol: "tcp",
            state: "open",
            reason: "syn-ack",
            service: {
              name: "ssh",
              product: "OpenSSH",
              version: "9.6p1",
              extraInfo: "Ubuntu 3ubuntu13",
              cpe: ["cpe:/a:openbsd:openssh:9.6p1"],
              method: "probed",
              confidence: 10,
            },
            identity: { ttl: 64, sshHostKeySha256: hash("a"), tlsCertSha256: null },
            banner: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13",
            scripts: [{ id: "ssh-hostkey", output: "256 SHA256:abc (ED25519)" }],
            http: [],
          },
          {
            port: 443,
            protocol: "tcp",
            state: "open",
            reason: "syn-ack",
            service: {
              name: "https",
              product: "nginx",
              version: "1.24.0",
              extraInfo: null,
              cpe: ["cpe:/a:nginx:nginx:1.24.0"],
              method: "probed",
              confidence: 10,
            },
            identity: { ttl: 64, sshHostKeySha256: null, tlsCertSha256: hash("e") },
            banner: null,
            scripts: [],
            http: [wikiEndpoint, bareIpEndpoint],
          },
        ],
      },
      {
        ip: "10.0.5.8",
        status: "down",
        reason: "no-response",
        observedAt: "2026-11-21T14:03:12Z",
        latencyMs: null,
        hostnames: [],
        error: null,
        ports: [],
      },
      {
        ip: "10.0.5.9",
        status: "timeout",
        reason: null,
        observedAt: "2026-11-21T14:05:40Z",
        latencyMs: null,
        hostnames: [],
        error: { code: "host-timeout", message: "no result within hostTimeoutMs" },
        ports: [],
      },
      {
        ip: "10.0.5.200",
        status: "cancelled",
        reason: null,
        observedAt: null,
        latencyMs: null,
        hostnames: [],
        error: null,
        ports: [],
      },
    ],
  });
}
