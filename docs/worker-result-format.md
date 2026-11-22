# Worker result format

**Status: locked.** This document is the source of truth for the JSON a scanning worker returns to the backend for one job.

- **Workers** work towards producing exactly this structure.
- **The backend** treats it as the only input for everything built on scan data: storing observations, diffs between scans, the dashboard, signatures and detections, JSON/CSV export and import, and DefectDojo.

Change this file first, with the team's agreement, and only then the code. When the code and this document disagree, the document wins. See [Current nmap-worker coverage](#current-nmap-worker-coverage).

## Scope

- One result describes **one worker run** over one job (one leased batch of addresses), not a whole `Scan`. The backend assembles a scan from many results, tied together by `scanId`.
- worker-manager may split a leased job into tasks (shards or address blocks), each one worker run with its own result. They all carry the job's `jobId` and `leaseId` and are uploaded with a task index (`POST /workers/manager/results`); the backend stores each as a separate result.
- The result holds only what the worker observed on the network. Everything derived (targets, detections, diffs, coverage) is computed by the backend. See [What the backend derives](#what-the-backend-derives).
- A host is identified by its **IP address**. Nested or overlapping targets (`10.0.0.0/16`, `10.0.5.0/24`, `10.0.5.7`, a domain resolving into them) are the backend's concern: the worker reports each address once.

## Document

```jsonc
{
  "scan": {
    "jobId": "0193a1…",
    "leaseId": "0193a2…",
    "scanId": "0193a0…",                  // the backend checks it matches the job
    "worker": { "id": "nmap-worker-1", "version": "0.3.0", "nmapVersion": "7.95" },

    "status": "partial",                  // completed | partial | failed
    "stopReason": "deadline",             // null | deadline | stop-requested | lease-lost | error
    "startedAt": "2026-11-21T14:00:02Z",
    "finishedAt": "2026-11-21T14:15:14Z",
    "durationMs": 912000,
    "phasesMs": {                         // feeds adaptive batch sizing
      "hostDiscovery": 41000,
      "portScan": 610000,
      "serviceDetection": 190000,
      "http": 71000
    },

    "params": {                           // what actually ran, not what was requested
      "subnet": "10.0.5.0/24",
      "ports": "21-23,80,443,8000-8100",
      "maxParallel": 4,
      "maxRatePerProcess": 300,
      "hostTimeoutMs": 300000,
      "httpTimeoutMs": 10000,
      "maxBodyBytes": 524288,
      "maxRedirects": 5,
      "nmapArgs": ["-sS", "-sV", "--version-light", "-T3", "--max-rate", "300",
                   "--host-timeout", "300s", "-p", "21-23,80,443,8000-8100", "-oX", "-"]
    },

    "counts": {                           // must match hosts[]
      "addresses": 256,
      "up": 12, "down": 180, "timeout": 2, "cancelled": 62, "failed": 0,
      "openPorts": 31,
      "httpEndpoints": 9,
      "httpRequests": 74
    },

    "error": null                         // job-level failure, e.g. { "code": "nmap-exit", "message": "exit code 1" }
  },

  "hosts": [
    {
      "ip": "10.0.5.7",
      "status": "up",                     // up | down | timeout | cancelled | failed
      "reason": "syn-ack",
      "observedAt": "2026-11-21T14:03:11Z",
      "latencyMs": 3,
      "hostnames": [
        { "name": "wiki.example.org", "source": "job" },
        { "name": "web01.example.org", "source": "ptr" },
        { "name": "wiki.example.org", "source": "tls-san" }
      ],
      "error": null,
      "ports": [
        {
          "port": 22, "protocol": "tcp", "state": "open", "reason": "syn-ack",
          "service": { "name": "ssh", "product": "OpenSSH", "version": "9.6p1", "extraInfo": "Ubuntu 3ubuntu13",
                       "cpe": ["cpe:/a:openbsd:openssh:9.6p1"], "method": "probed", "confidence": 10 },
          "identity": { "ttl": 64, "sshHostKeySha256": "…", "tlsCertSha256": null },
          "banner": "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13",
          "scripts": [{ "id": "ssh-hostkey", "output": "…" }],
          "http": []
        },
        {
          "port": 443, "protocol": "tcp", "state": "open", "reason": "syn-ack",
          "service": { "name": "https", "product": "nginx", "version": "1.24.0", "extraInfo": null,
                       "cpe": ["cpe:/a:nginx:nginx:1.24.0"], "method": "probed", "confidence": 10 },
          "identity": { "ttl": 64, "sshHostKeySha256": null, "tlsCertSha256": "…" },
          "banner": null,
          "scripts": [],
          "http": [
            {
              "scheme": "https",
              "vhost": "wiki.example.org",        // null = requested by bare IP
              "url": "https://wiki.example.org/",
              "finalUrl": "https://wiki.example.org/login",
              "statusCode": 200,
              "title": "Wiki – login",
              "headers": [                        // without Set-Cookie; cookies are below
                { "name": "server", "value": "nginx/1.24.0" },
                { "name": "x-powered-by", "value": "PHP/8.1.2" }
              ],
              "cookies": [
                { "name": "PHPSESSID", "valueSha256": "…", "secure": true, "httpOnly": false,
                  "sameSite": null, "domain": null, "path": "/", "expires": null }
              ],
              "redirects": [
                { "url": "https://wiki.example.org/", "statusCode": 302, "location": "/login", "followed": true }
              ],
              "body": {
                "sha256": "…", "size": 18342, "contentType": "text/html",
                "content": "<!doctype html>…",
                "truncated": false
              },
              "favicon": { "url": "https://wiki.example.org/favicon.ico", "mmh3": -1137954245, "sha256": "…" },
              "tls": {
                "version": "TLSv1.3", "cipher": "TLS_AES_256_GCM_SHA384", "alpn": "h2",
                "cert": { "subjectCn": "wiki.example.org", "san": ["wiki.example.org"], "issuer": "R11",
                          "notBefore": "…", "notAfter": "…", "serial": "…", "sha256": "…",
                          "selfSigned": false, "keyAlgorithm": "RSA", "keyBits": 2048 }
              },
              "probes": [
                { "path": "/wp-admin/", "statusCode": 302, "location": "/wp-login.php",
                  "title": null, "size": 0, "bodySha256": null, "error": null },
                { "path": "/version", "statusCode": 404, "location": null,
                  "title": "Not Found", "size": 153, "bodySha256": "…", "error": null }
              ],
              "error": null
            },
            {
              "scheme": "https", "vhost": null, "url": "https://10.0.5.7/",
              "statusCode": 404, "title": null
              // … every field listed above
            }
          ]
        }
      ]
    },

    { "ip": "10.0.5.8", "status": "down", "reason": "no-response", "observedAt": "2026-11-21T14:03:12Z",
      "latencyMs": null, "hostnames": [], "error": null, "ports": [] },

    { "ip": "10.0.5.9", "status": "timeout", "reason": null, "observedAt": "2026-11-21T14:05:40Z",
      "latencyMs": null, "hostnames": [], "ports": [],
      "error": { "code": "host-timeout", "message": "no result within hostTimeoutMs" } },

    { "ip": "10.0.5.200", "status": "cancelled", "reason": null, "observedAt": null,
      "latencyMs": null, "hostnames": [], "error": null, "ports": [] }
  ]
}
```

## Conventions

- **camelCase** for every key.
- Times are ISO 8601 in UTC (`2026-11-21T14:03:11Z`). Durations are integer milliseconds with an `Ms` suffix.
- **Every key is always present.** Unknown values are `null`, and empty lists are `[]`. Omitted keys appear only in the abbreviated example above.
- Hashes are lowercase hex SHA-256, except `favicon.mmh3`, which is a signed 32-bit MurmurHash3 of the base64-encoded favicon (the convention used by Shodan and similar tools).
- Error objects are `{ "code": string, "message": string }`. `code` is kebab-case and machine-readable (`host-timeout`, `nmap-exit`, `tls-handshake`, `http-timeout`, `connect-refused`).

## Field reference

### `scan`

| Field | Type | Meaning |
|---|---|---|
| `jobId`, `leaseId`, `scanId` | string | The job, the lease it ran under, and its parent scan |
| `worker` | `{ id, version, nmapVersion }` | Which worker produced the result; `nmapVersion` is `null` for workers without Nmap |
| `status` | `completed` \| `partial` \| `failed` | `completed`: every address is `up` or `down`. `partial`: at least one is `timeout`, `cancelled` or `failed`. `failed`: the job itself could not run (`error` is set) |
| `stopReason` | `null` \| `deadline` \| `stop-requested` \| `lease-lost` \| `error` | Why a job ended early: the time window expired, the backend asked to stop, a heartbeat failed, or an error |
| `startedAt`, `finishedAt`, `durationMs` | string, string, int | Wall-clock span of the job |
| `phasesMs` | `{ hostDiscovery, portScan, serviceDetection, http }` | Time per phase; a phase that did not run is `0` |
| `params` | object | The parameters the worker actually used (below) |
| `counts` | object | Totals over `hosts[]` (below) |
| `error` | error \| `null` | Job-level failure |

`scan.params`:

| Field | Meaning |
|---|---|
| `subnet` | The job's subnet (CIDR), or `null` when the addresses do not form one aligned block |
| `ports` | TCP port spec that was scanned, e.g. `22,80,8000-8100` |
| `maxParallel`, `maxRatePerProcess` | Worker concurrency and rate limit; Nmap reports processes/packets per second, httpx reports threads/HTTP requests per second |
| `hostTimeoutMs`, `httpTimeoutMs` | Per-host Nmap timeout (`null` for other workers) and per-request HTTP timeout |
| `maxBodyBytes`, `maxRedirects` | Limits for `http[].body.content` and `http[].redirects` |
| `nmapArgs` | The Nmap argument vector **without the target addresses**; `[]` for workers without Nmap |

`scan.counts`: `addresses` (addresses in the job), one count per host status (`up`, `down`, `timeout`, `cancelled`, `failed`), `openPorts`, `httpEndpoints` (entries in all `http[]` lists) and `httpRequests` (every HTTP request sent, probes and favicon included).

### `hosts[]`

| Field | Type | Meaning |
|---|---|---|
| `ip` | IPv4 string | The address; unique within the result |
| `status` | `up` \| `down` \| `timeout` \| `cancelled` \| `failed` | `up`: responded. `down`: scanned, no response. `timeout`: hit `hostTimeoutMs`. `cancelled`: never scanned or interrupted (deadline, stop, lost lease). `failed`: scanning it errored |
| `reason` | string \| `null` | Nmap's reason for the status (`syn-ack`, `echo-reply`, `no-response`, …) |
| `observedAt` | string \| `null` | When the result for this host was obtained; `null` for `cancelled` |
| `latencyMs` | int \| `null` | Round-trip time reported by Nmap |
| `hostnames` | `[{ name, source }]` | `source`: `job` (domain given in the job), `ptr` (reverse DNS), `tls-san` (from a certificate) |
| `error` | error \| `null` | Why the host is `timeout` or `failed` |
| `ports` | port[] | Open ports; `[]` unless `up` |

### `hosts[].ports[]`

| Field | Type | Meaning |
|---|---|---|
| `port`, `protocol` | int, `tcp` | The port |
| `state` | `open` | Only open ports are reported. The field is kept for future UDP (`open\|filtered`) |
| `reason` | string \| `null` | Nmap's reason (`syn-ack`) |
| `service` | object \| `null` | Nmap service detection: `name`, `product`, `version`, `extraInfo`, `cpe[]`, `method` (`probed` \| `table`), `confidence` (Nmap's `conf`, 0–10) |
| `identity` | `{ ttl, sshHostKeySha256, tlsCertSha256 }` | Signals that tell machines behind one IP apart (NAT, port forwarding); each may be `null` |
| `banner` | string \| `null` | Raw service banner, for non-HTTP services |
| `scripts` | `[{ id, output }]` | Raw output of NSE scripts that is not mapped to the fields above |
| `http` | http[] | One entry per HTTP endpoint on this port; `[]` if the port does not speak HTTP |

### `hosts[].ports[].http[]`

One entry per `(scheme, vhost)`: once by bare IP (`vhost: null`) and once for each domain the job assigned to this IP.

| Field | Type | Meaning |
|---|---|---|
| `scheme` | `http` \| `https` | |
| `vhost` | string \| `null` | Host header and SNI; `null` = bare IP |
| `url`, `finalUrl` | string | First request, and the URL after followed redirects |
| `statusCode` | int \| `null` | Status of the final response; `null` if no response (`error` set) |
| `title` | string \| `null` | HTML `<title>`, whitespace-collapsed |
| `headers` | `[{ name, value }]` | Final response headers in order, names lowercase, **without `Set-Cookie`** |
| `cookies` | cookie[] | Parsed from every `Set-Cookie` along the chain: `name`, `valueSha256`, `secure`, `httpOnly`, `sameSite` (`Strict` \| `Lax` \| `None` \| `null`), `domain`, `path`, `expires`. **The value itself is never sent** |
| `redirects` | `[{ url, statusCode, location, followed }]` | The redirect chain; `followed: false` for a redirect the worker did not follow (off-host or over `maxRedirects`) |
| `body` | `{ sha256, size, contentType, content, truncated }` \| `null` | `null` when there was no response. `content` only for text types (HTML, JSON, XML, plain text), cut at `maxBodyBytes`; otherwise `null` |
| `favicon` | `{ url, mmh3, sha256 }` \| `null` | From `<link rel="icon">` or `/favicon.ico` on the same host |
| `tls` | object \| `null` | `version`, `cipher`, `alpn`, `cert` (`subjectCn`, `san[]`, `issuer`, `notBefore`, `notAfter`, `serial`, `sha256`, `selfSigned`, `keyAlgorithm`, `keyBits`); `null` for `http` |
| `probes` | probe[] | Results of the probe paths from the job: `path`, `statusCode`, `location`, `title`, `size`, `bodySha256`, `error` |
| `error` | error \| `null` | Why the endpoint returned no response |

## Rules

**Completeness and consistency**

- Every address the worker run was given appears in `hosts[]` exactly once. The backend treats a missing address as `cancelled`.
- Only `up` and `down` count as scanned (coverage). `timeout`, `cancelled` and `failed` addresses are unknown, never "gone".
- `counts` must agree with `hosts[]`. On a mismatch the backend trusts `hosts[]`.
- A result may be sent more than once for the same `leaseId` + task index (retries). The backend stores it once.

**Scan safety** (PDF, section 2)

- The worker scans only the addresses and ports of its job, at the job's rate limits, and stops at the deadline.
- HTTP requests are `GET` only, without credentials, without submitting forms, without request bodies.
- `probes` request only the paths the job lists and never follow their redirects.
- Redirects are followed only within the same host (the same IP or the same `vhost`; switching between `http` and `https` is allowed), at most `maxRedirects` times. Others are recorded with `followed: false`.

**Sensitive data**

- Cookie values never leave the worker; only `valueSha256` does.
- The backend encrypts at rest (PDF item 16): `headers`, `cookies`, `body.content`, `tls.cert`, `banner`, `scripts` and `probes`. Fields used for filtering and diffs (`ip`, `port`, `service`, `statusCode`, `title`) stay in plaintext.
- A result can be large (up to `maxBodyBytes` per endpoint). The backend's result endpoint must accept large, gzip-compressed bodies.

## What the job must provide

This format depends on the following `NmapJob` inputs:

- **Domains per IP:** one IP with a list of domains (`vhost`s), instead of one `domain` per target. This settles the open question in [`apps/workers/README.md`](../apps/workers/README.md#scan-jobs-in-the-database).
- **Probe paths:** the paths taken from the active signatures (`/admin`, `/login`, `/version`, …).
- **Limits:** `maxBodyBytes`, `maxRedirects` and `httpTimeoutMs`, alongside the existing ones.

## What the backend derives

The worker result does not contain these. The backend computes them from stored results and the inventory:

| Data | Source |
|---|---|
| Targets a host belongs to | Address in the range of an `ip`/`cidr` target, or in the DNS resolution of a `domain` target at scan time. Nested targets simply give a host several targets |
| Detections (CMS, framework, application server, IoT, admin panel, staging, interesting headers and cookies, custom signatures) | Signatures evaluated on `headers`, `cookies`, `body.content`, `favicon`, `probes`, `banner` and `service`. Built-in fingerprints and custom signatures run on the same engine, each with a `confidence` |
| Coverage of a scan | `up`/`down` hosts of its jobs |
| New, gone and changed hosts/services/endpoints | Comparison of two scans (by default the previous scan with results), only where both have a conclusive answer: an address that either scan did not cover or got no `up`/`down` for is `unknown`. Keys: host `ip`, service `ip + protocol + port`, endpoint `ip + port + scheme + vhost` |
| What changed in a service | A field-level comparison of one normalized view of the port (service identity, SSH host key, and per endpoint: status, title, redirect path, technology and security headers, cookie names and flags, certificate, TLS version, favicon, probe statuses). The port fingerprint is a hash of the same view |
| Likely machines behind one IP | Ports grouped by matching `identity` signals |
| Host lifecycle (active, unstable, missing, inactive) | Consecutive misses (`down`) and up/down flips over the scans that covered the address; `timeout`, `cancelled` and `failed` count as no information |

## Where it lives in code

- **Contract:** `WorkerResultSchema` in `packages/contracts/src/workers/worker-result.schema.ts` validates this format. It is the request body of `POST /workers/nmap/results` in `openapi.json`. `worker-result.fixture.ts` next to it builds the example above for tests.
- **Backend:** `resultsService.ingest()` (`apps/backend/src/modules/results/`) turns a validated result into database rows. See [Scan results in the backend README](../apps/backend/README.md#scan-results).

## Current nmap-worker coverage

`nmap-worker` produces the `{ scan, hosts }` structure above, including all required keys, host and port statuses, service metadata, counts, and job timing. It accepts multiple domains per IP, probe paths, and HTTP limits in the job. It currently runs Nmap service detection only: `http[]`, banners, and cryptographic identity fields are empty or `null`; probe paths are not requested yet. The HTTP/TLS collection phase still needs implementation. Because Nmap scans each host's assigned port list, `scan.params.ports` is the union of those lists and `nmapArgs` contains the common arguments; each invocation adds its own `-p`, output path and target IP.

## Current httpx-worker coverage

`httpx-worker` probes assigned IPs, ports and vhosts with ProjectDiscovery httpx. It fills HTTP status, title, headers, hashed cookie values, bounded body, unfollowed redirects and explicit path probes. It leaves Nmap service metadata, favicon and TLS certificate details `null` because those values are not produced by its current invocation. For a host-object target, its ports are already known open; for an address/range target, only a responding HTTP port is reported open. The backend combines worker observations on reads, retaining Nmap service metadata and adding HTTP responses from httpx; stored results remain separate.
