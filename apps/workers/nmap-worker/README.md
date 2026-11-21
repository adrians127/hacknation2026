# nmap-worker

A C++23 worker for TCP service and version detection on IP/port hits supplied by Masscan. It accepts a JSON job, runs Nmap on only those IPs and ports, parses Nmap XML internally, and produces JSON results. It never writes to the database.

## Build

From the repository root:

```bash
pnpm workers:build
```

The Docker image uses Ubuntu for both build and runtime. It installs Nmap, libcurl, pugixml, and nlohmann/json from system packages. The worker runs as a non-root user. Compose grants raw network capabilities and selects SYN scanning; local builds default to TCP connect scanning.

For a local build on macOS:

```bash
brew install cmake ninja nmap nlohmann-json pugixml
cmake --preset debug -S apps/workers/nmap-worker
cmake --build apps/workers/nmap-worker/build/debug
ctest --test-dir apps/workers/nmap-worker/build/debug --output-on-failure
```

## JSON job mode

`--job-file` runs one job without a backend. It prints one JSON result to stdout and diagnostics to stderr. The exit code is zero only if all hosts were scanned.

```bash
apps/workers/nmap-worker/build/debug/nmap-worker --job-file job.json
```

Example `job.json`:

```json
{
  "job_id": "job-123",
  "lease_id": "lease-456",
  "subnet": "192.0.2.0/24",
  "deadline": "2099-01-01T00:00:00Z",
  "limits": {
    "max_parallel": 2,
    "max_rate_per_process": 50,
    "host_timeout_ms": 120000
  },
  "targets": [
    { "ip": "192.0.2.10", "domain": null, "tcp_ports": [22, 443] }
  ]
}
```

The worker validates that every target is an IPv4 address within `subnet` and that each port is in `1..65535`. Duplicate IPs are rejected; duplicate ports are removed. Job limits may lower the worker's configured maxima but cannot raise them. `domain` is metadata retained in the result; Nmap receives only the numeric IP.

Results contain `job_id`, `lease_id`, `status`, `duration_ms`, and one record per target. Each host has `status` (`scanned`, `pending`, `failed`, `timeout`, or `cancelled`), its reported ports, service name/product/version/CPE when available, scripts, and an optional error. A requested port absent from explicit Nmap XML port entries is marked `not_reported` rather than assumed closed. A job is `partial` if any host is not `scanned`.

## HTTP pull mode

With no arguments, the process polls the backend. `WORKER_TOKEN` is required and sent as a bearer token. These JSON endpoints are defined in `packages/contracts`:

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/workers/nmap/lease` | `200` with a JSON job, or `204` if no work |
| `POST` | `/workers/nmap/heartbeat` | extend the current lease |
| `POST` | `/workers/nmap/results` | accept a JSON result |

The backend handlers are not implemented yet. The worker retries failed result delivery three times. If a heartbeat fails, it stops the active scan and sends a partial result. The backend must make result submission idempotent and requeue unfinished hosts after a lease expires.

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

The scan uses `-n -Pn -sV` and only the target's supplied TCP ports. NSE scripts and OS fingerprinting are not enabled. Nmap's `--max-rate` does not cap every version-detection probe, and each process has its own limit. The backend must also limit concurrent jobs and global traffic. Scan only authorized ranges and ports.

Nmap XML and stderr are written to temporary files and removed after each host. An expired deadline stops launching hosts and terminates active Nmap processes; unfinished hosts remain `pending` or receive a timeout/cancellation status.

## Docker Desktop on macOS

Containers run inside a virtual machine, so LAN scans from macOS pass through NAT and may differ from scans on Linux. For AGH lab testing, run the worker on a Linux host.
