# nmap-worker

A C++23 worker for TCP service and version detection on address ranges or on IP/port hits supplied by Masscan. It accepts a JSON job in the [shared job format](../README.md#job-and-result-format), runs Nmap on only those IPs and ports, parses Nmap XML internally, and produces a result with the same schema as masscan-worker's. It never writes to the database.

## Build

From the repository root, build the Docker image. The image build runs both the
fake-Nmap integration tests and a real scan against a temporary local HTTP server:

```bash
pnpm workers:nmap:build
```

Then smoke test the non-root runtime image with a loopback port inside the container:

```bash
pnpm workers:nmap < apps/workers/nmap-worker/examples/job-local.json > result.json
```

Port 1 is normally closed, so expect `scan.status: "completed"`, one `up` host and
`openPorts: 0`. The build-time real-scan test checks an open port while running
Nmap service detection. `pnpm workers:nmap` accepts the same `--input`, `--output` and
`--pretty` flags as the local binary. The Docker image uses Ubuntu for both
build and runtime. The worker runs as a non-root user. Compose grants raw
network capabilities and sets `NMAP_PRIVILEGED=1` for SYN scanning; local
builds default to TCP connect scanning.

For a local build on macOS:

```bash
brew install cmake ninja nmap nlohmann-json pugixml
cmake --preset debug -S apps/workers/nmap-worker
cmake --build apps/workers/nmap-worker/build/debug
ctest --test-dir apps/workers/nmap-worker/build/debug --output-on-failure
```

## JSON job mode

Like `masscan-worker`, the default mode reads one job from stdin and writes one result to stdout. `--input` and `--output` select files; `--job-file` remains an alias for `--input`. Output files are written atomically. Logs and errors go to stderr. A JSON result is also written for invalid input.

```bash
apps/workers/nmap-worker/build/debug/nmap-worker < job.json > result.json
apps/workers/nmap-worker/build/debug/nmap-worker --input job.json --output result.json --pretty
```

Exit codes: `0` for `completed` or `partial`, `1` for a failed scan or output error, `2` for invalid input.

Example `job.json`:

```json
{
  "job_id": "0193a1aa-6c1e-7b3f-9d2a-4e5f60718293",
  "lease_id": "lease-456",
  "scan_id": "0193a0f2-1b2c-7d3e-8f40-516273849506",
  "targets": [
    "192.0.2.64/30",
    { "ip": "192.0.2.10", "ports": [22, 443], "domains": ["example.org"] }
  ],
  "exclude": ["192.0.2.66"],
  "ports": [80, 443],
  "rate": 100,
  "max_duration_seconds": 900,
  "max_parallel": 2,
  "max_rate_per_process": 50,
  "host_timeout_ms": 120000,
  "http_timeout_ms": 10000,
  "max_body_bytes": 524288,
  "max_redirects": 5,
  "probe_paths": ["/admin"]
}
```

**Shared fields** (`job_id`, `scan_id`, `lease_id`, `targets`, `exclude`, `ports`, `rate`, `max_duration_seconds`) work as in [masscan-worker](../masscan-worker/README.md#input): the ids are optional, `targets` and `exclude` take IPv4 addresses, CIDRs and ranges, `ports` defaults to `1-65535`. Unlike masscan-worker, **`max_duration_seconds` is required** (1 to 604800, counted from when the job is read).

**Host objects** in `targets` give one address its own ports and domains: `{ "ip": "192.0.2.10", "ports": [22, 443], "domains": ["example.org"] }`. This is how Masscan hits are handed over. Without `ports` the object gets the job's `ports`. An address listed twice (or as an object inside a range) is scanned once, with the union of its ports and domains. `exclude` applies to host objects too.

A job covers at most 1024 addresses, because every address appears in `hosts[]`.

**Rate:** `rate` is the packets per second for the whole job, as with masscan-worker. It is split evenly across the parallel Nmap processes (fewer processes if `rate` is smaller than `max_parallel`), and it can only lower `max_rate_per_process` and `NMAP_MAX_RATE_PER_PROCESS`, never raise them. The values used are in `scan.params.maxParallel` and `maxRatePerProcess`.

**Limits:** `max_parallel`, `max_rate_per_process`, `host_timeout_ms`, `http_timeout_ms`, `max_body_bytes` and `max_redirects` may lower the worker's configured maxima but cannot raise them. `probe_paths` (at most 128, each starting with `/`) are accepted for the shared job format.

**Stopping:** `SIGINT`/`SIGTERM` (Ctrl+C, `docker stop`, worker-manager) stop the scan instead of killing the worker: running Nmap processes are terminated, unfinished hosts are `cancelled`, and a `partial` result with `stopReason: "stop-requested"` is still written (exit code `0`). In HTTP mode a failed heartbeat stops the scan the same way, with `stopReason: "lease-lost"`.

Fields worker-manager adds (`task_id`, `task_index`, `task_count`) are ignored. See [`worker-manager`](../worker-manager/README.md#worker-contract) for running this worker from a job list. Nmap receives only numeric IPs and validated port ranges.

The result has the [shared schema](../README.md#job-and-result-format): `scan` and `hosts` only, in the key order of [`docs/worker-result-format.md`](../../../docs/worker-result-format.md), every field present, unknowns as `null` and empty lists as `[]`. Invalid input gives the same document as masscan-worker's (`invalid-input`, `hosts: []`, `null` params and counts), and Nmap failing to start on every host is `scanner-unavailable`. `scan.params.subnet` is the targets' CIDR when they form exactly one aligned block, otherwise `null`. `scan.params.ports` is the union of assigned ports across the job; each Nmap invocation scans only its target's ports. `scan.params.nmapArgs` lists arguments shared by all invocations.

Every target appears once with `up`, `down`, `timeout`, `cancelled`, or `failed`. Only open ports appear. Service name, product, version, extra info, CPE, method, confidence, port reason, TTL and NSE script output come from Nmap XML when available. An incomplete job is `partial`.

HTTP requests and TLS fingerprinting are not implemented yet. The worker accepts `probe_paths` and the HTTP limits for the shared job format, but does not request those paths; `http[]` and HTTP counters remain empty or zero.

## HTTP pull mode

With `--http`, the process polls the backend. `WORKER_TOKEN` is required and sent as a bearer token. These JSON endpoints are defined in `packages/contracts`:

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/workers/nmap/lease` | `200` with a JSON job, or `204` if no work |
| `POST` | `/workers/nmap/heartbeat` | extend the current lease |
| `POST` | `/workers/nmap/results` | accept a JSON result |

The leased job uses the format above. `NmapJobSchema` in `packages/contracts` still describes the earlier format (`subnet`, `deadline`, `limits`, `tcp_ports`) and has to be updated before the backend handlers are written. The backend handlers are not implemented yet. The worker retries failed result delivery three times. If a heartbeat fails, it stops the active scan and sends a partial result. The backend must make result submission idempotent and requeue unfinished hosts after a lease expires.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `http://localhost:3001/v1` | Backend base URL; Compose uses `http://host.docker.internal:3001/v1` |
| `WORKER_TOKEN` | none | Required in HTTP mode |
| `NMAP_BINARY` | `nmap` | Nmap executable, also useful for a test double |
| `NMAP_SCAN_TYPE` | `connect` | `connect` (`-sT`) or `syn` (`-sS`); Compose selects `syn` |
| `NMAP_MAX_PARALLEL` | `2` | Maximum concurrent Nmap processes for one job |
| `NMAP_MAX_RATE_PER_PROCESS` | `50` | Maximum port scan packets per second per Nmap process |
| `NMAP_HOST_TIMEOUT_MS` | `120000` | Maximum time per host |
| `WORKER_POLL_INTERVAL_MS` | `3000` | Delay before the next lease request |
| `WORKER_HEARTBEAT_INTERVAL_MS` | `5000` | Time between heartbeats |

The scan uses `-n -Pn -sV --version-light` and only the target's supplied TCP ports. NSE scripts and OS fingerprinting are not enabled. Nmap's `--max-rate` does not cap every version-detection probe, and each process has its own limit. The backend must also limit concurrent jobs and global traffic. Scan only authorized ranges and ports.

Nmap XML and stderr are written to temporary files and removed after each host. An expired deadline stops launching hosts and terminates active Nmap processes; unfinished hosts are `cancelled`. A per-host timeout is `timeout`.

## Docker Desktop on macOS

Containers run inside a virtual machine, so LAN scans from macOS pass through NAT and may differ from scans on Linux. For AGH lab testing, run the worker on a Linux host.
