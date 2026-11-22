# httpx-worker

C++23 adapter around [ProjectDiscovery httpx](https://docs.projectdiscovery.io/opensource/httpx/overview)
v1.12.0. It accepts one JSON job, calls httpx without a shell, and writes the shared
`{scan, hosts}` result from `docs/worker-result-format.md`. It has no backend connection.

## Run

From the repository root:

```bash
pnpm workers:httpx:build
pnpm workers:httpx < apps/workers/httpx-worker/examples/job-local.json > result.json
```

Locally, build with CMake and set `HTTPX_BINARY` to the ProjectDiscovery httpx
executable (`python-httpx` is a different project). `--input FILE`, `--output FILE`
and `--pretty` have the same meaning as the other workers. Defaults are stdin and
stdout. Logs go to stderr. The manager uses `--input` and `--output` and adds task
metadata, which this worker ignores. Exit codes: 0 completed/partial, 1 scan failure,
2 invalid job. Even a failed job writes a result; output files are renamed atomically.

## Job

The common job fields are supported: `job_id`, `scan_id`, `lease_id`, `targets`,
`exclude`, `ports`, `rate`, `max_duration_seconds`. Targets can be IPv4 addresses,
CIDRs, ranges or `{ip, ports, domains}` objects, with the same host-object meaning
as nmap-worker. `max_duration_seconds` is required. Up to 1024 addresses and 8192
planned HTTP requests fit in one task; split larger work with the manager's `chunk`
or `ranges` strategy. Each port is tried with exact HTTP and HTTPS schemes. The
shared default `ports: "1-65535"` exceeds this worker's request cap for even one
address, so HTTP jobs should provide discovered ports explicitly. The
worker probes `/` plus the explicitly listed `probe_paths` (at most 128); no other
paths are requested. It does not follow redirects.

An object target's ports are treated as **known open** from Masscan/Nmap. The result
reports them as open even when none speaks HTTP. A plain address/range has no such
prior observation: it is `up` and has an open port only after an HTTP response.
The job should normally contain only previously discovered ports. Unknown fields
are ignored.

`rate` is the manager-granted budget. This worker interprets it as a maximum
requests/second and hard-caps it at 25 (`HTTPX_WORKER_MAX_RATE` can lower this cap).
`max_parallel` and `http_timeout_ms` may lower the defaults (10 threads and 10 s).
The CLI accepts whole-second timeouts, so `http_timeout_ms` must be at least 1000
and is rounded down to seconds.
`max_body_bytes` may lower 524288 bytes. The `max_redirects` input is accepted for
the common format, though redirects are deliberately not followed. The worker
sets httpx `-nfs`, `-retries 0`, `-rstr`, `-rl`, `-t`, `-timeout` and `-no-stdin`.
One httpx process handles all ports/schemes for each `(IP, vhost)`; domain jobs use
`Host` and SNI while connecting to the assigned IP.

## Result mapping

Each responding `(IP, port, scheme, vhost)` becomes one `http[]` entry. A path
probe is nested under that entry. `Set-Cookie` values are SHA-256 hashed and never
written as plaintext. Redirects are recorded with `followed: false`; `finalUrl`
equals `url`. The body is bounded and stored only for text-like media types.
Non-HTTP ports keep `http: []`. This worker does not fabricate Nmap service
versions, banners, TTL or NSE output. Fields not available from its current
httpx invocation, including favicon and complete TLS certificate metadata, are
`null`. The raw httpx JSONL stays in temporary files and is removed.

The common result schema currently has fields named `maxRatePerProcess` and
`nmapArgs`; for this worker they mean the effective HTTP request rate and `[]`.
`hostTimeoutMs` and `worker.nmapVersion` are `null`.

## Manager

The manager image includes `httpx-worker` and the pinned httpx binary. Its default
pipeline is `masscan,nmap,httpx`, and its default per-worker cap includes
`httpx=25`. A job with `worker: "httpx"` works with `split: {"strategy":"chunk"}`
for host objects. The manager orders overlapping work and can upload each task
result with `task_index` and `task_count` in `--poll` mode. The backend must
construct the HTTP job from discovery results. Its `/workers/manager/lease`
endpoint is not implemented yet; file mode works without it.

The backend currently stores each worker result as a separate `HostObservation`.
Its scan read path selects one observation per IP and prefers Nmap for an `up`
host. Thus both results persist, but the selected Nmap observation hides httpx's
`http[]` data. Backend integration should combine observations by
`(scanId, ip, protocol, port)` when reading a scan: retain Nmap service/version,
scripts and port identity, and attach httpx endpoints (keyed by scheme and
vhost). It should keep observations and result IDs intact for audit/history,
then calculate the effective fingerprint from the combined port. Ingest must
also keep HTTP tasks in a distinct lease or task index: `(leaseId, taskIndex)`
is the backend's deduplication key. The worker reports
`worker.id: "httpx-worker"`.

## Test

```bash
cmake --preset debug -S apps/workers/httpx-worker
cmake --build apps/workers/httpx-worker/build/debug
ctest --test-dir apps/workers/httpx-worker/build/debug --output-on-failure
```

The integration test uses a fake httpx binary to check CLI arguments and JSONL
normalization. The Docker build pins httpx v1.12.0 and runs that test.
