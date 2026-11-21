# masscan-worker

A **C++23** worker for fast, wide TCP SYN sweeps (whole subnets, up to all 65,535 ports) built on **masscan**. You give it one JSON job with ranges, ports and limits. It runs one masscan process, streams masscan's NDJSON output, and writes one JSON result: the live hosts and their open ports, grouped into subnets (the network topology).

The worker runs one job and exits. It does not talk to the backend. An orchestration layer starts it per job, reads the result and decides what comes next (resume, re-shard, hand hosts to `nmap-worker` for service detection). Wrapping it in the HTTP pull loop from [`../README.md`](../README.md) is a separate step.

## Run (Docker only)

The worker is built and run only in Docker. From the repo root:

```bash
pnpm workers:build                                                  # build the image; runs the unit tests
pnpm workers:masscan < apps/workers/masscan-worker/examples/job.json > result.json
echo '{"targets":["192.168.1.1"],"ports":[22,80,443]}' | pnpm workers:masscan --pretty
MASSCAN_WORKER_LOG_LEVEL=debug pnpm workers:masscan < job.json > result.json
```

`pnpm workers:masscan` is `docker compose -f docker/docker-compose.workers.yml run --rm -T masscan-worker`. Anything after it is passed to the worker as flags. The job goes in on stdin, the result JSON comes out on stdout, and the logs go to stderr, so `> result.json` captures only the result and the logs stay on your terminal.

| Flag | Default | Description |
|---|---|---|
| `--input` | `-` (stdin) | Job JSON |
| `--output` | `-` (stdout) | Result JSON. A file is written atomically (temp file + rename) |
| `--pretty` | off | Indent the output |

A result JSON is written **in every case**, including invalid input.

| Exit code | Meaning |
|---|---|
| `0` | `completed` or `partial` (stopped by the time window or a signal) |
| `1` | `failed`: masscan missing or exited with an error |
| `2` | `failed`: invalid input or invalid usage |

`SIGINT`/`SIGTERM` (Ctrl+C, `docker stop`) stop the scan gracefully. The worker passes the stop on to masscan, waits for in-flight replies, and writes a `partial` result with a resume point.

## Input

See [`examples/`](examples/). Only `targets` is required. For a first smoke test use [`examples/job-small.json`](examples/job-small.json) (16 addresses × 7 ports, done in a few seconds).

| Field | Default | Description |
|---|---|---|
| `job_id` | `""` | Echoed back in the result |
| `targets` | required | IPv4 address, CIDR (`10.0.0.0/16`) or range (`10.0.0.1-10.0.0.50`). An array, or a comma-separated string |
| `exclude` | `[]` | Same formats as `targets`. Subtracted before scanning |
| `ports` | `"1-65535"` | `"22,80,8000-8100"` or `[22, "8000-8100"]`. TCP only, ports 1–65535 |
| `rate` | `MASSCAN_WORKER_DEFAULT_RATE` | Packets per second. Clamped to `MASSCAN_WORKER_MAX_RATE`, with a warning |
| `wait_seconds` | `3` | How long masscan keeps listening for replies after the last probe (0–60) |
| `retries` | `0` | Extra probes per port (0–5) |
| `max_duration_seconds` | none | Time window. When it runs out, the scan stops and the result is `partial`. The stop itself takes up to `wait_seconds` more, so leave that margin |
| `group_prefix` | `24` | Prefix length used to group live hosts into subnets (8–32) |
| `shard` | none | `{"index": 1, "total": 4}`, passed to masscan `--shards`. Splits one job across workers. Every shard needs the same `seed` |
| `seed` | random | masscan's randomization seed. Required with `shard` and `resume_index` |
| `resume_index` | `0` | Continue an interrupted scan. Copy it from the previous result's `resume` |
| `adapter`, `adapter_ip`, `router_mac` | auto | masscan `--adapter`, `--adapter-ip`, `--router-mac`. Only needed when auto-detection fails (e.g. some container networks) |

**Resuming in the next window:** send the **same** `targets`, `exclude`, `ports` and `shard`, plus `seed` and `resume_index` from `result.resume`. masscan's index refers to the randomized (address × port) space, so any change to those fields makes it point somewhere else.

## Output

See [`examples/result.json`](examples/result.json). Top-level fields:

| Field | Description |
|---|---|
| `status` | `completed`, `partial` or `failed` |
| `stop_reason` | `time_window`, `signal` or `null` |
| `error` | `{code, message}` or `null`. Codes: `invalid_input`, `scanner_unavailable`, `scanner_failed`, `io_error` |
| `scan` | The normalized job: `effective_ranges`, `address_count`, `port_count`, `probe_count`, the rate actually used, `seed`, … |
| `timing` | `started_at`, `finished_at`, `duration_ms`, `progress` (0–1, `null` when unknown, e.g. for shards), `addresses_per_second`, `probes_per_second`. The orchestrator uses these to size the next subgroups |
| `resume` | `{seed, resume_index, shard}` on a `partial` result. Pass it into the next job |
| `summary` | `hosts_up`, `open_ports`, `subnets` |
| `topology.subnets[]` | `{cidr, hosts_up, open_ports, hosts[]}`, sorted numerically |
| `topology.subnets[].hosts[]` | `{ip, open_ports[{port, protocol}], ttl, estimated_hops, os_family_hint}` |
| `topology.hop_distribution` | Host count per estimated hop distance |
| `warnings` | e.g. a clamped rate, or a resume point that was lost |

`estimated_hops` and `os_family_hint` are heuristics based on the SYN-ACK TTL. The common initial TTLs are 64 (unix-like), 128 (windows) and 255 (network devices), and hops = initial − observed. Use them as layout hints, not as fingerprinting. Service and OS detection belong to `nmap-worker`.

A `failed` result still contains whatever masscan reported before it failed.

## Logging

The worker logs every step to stderr, one line per event. The level is `info` by default:

```
2026-11-21T17:21:40.560Z info  masscan-worker starting version=0.1.0 input=stdin output=stdout max_rate_pps=100000
2026-11-21T17:21:40.561Z info  job accepted job_id=demo targets=10.0.0.0-10.0.1.255 addresses=512 ports=22,443,3389 port_count=3 probes=1536 rate_pps=5000 estimated_s=3 max_duration_s=null seed=1978539184939333
2026-11-21T17:21:40.562Z info  masscan found version=1.3.2 binary=masscan
2026-11-21T17:21:40.563Z info  masscan started pid=16729
2026-11-21T17:21:41.668Z info  35.00% done rate_pps=9980 hosts_up=1 open_ports=2 elapsed_s=1 eta_s=6
2026-11-21T17:21:42.873Z info  85.00% done rate_pps=9980 hosts_up=1 open_ports=2 elapsed_s=2 eta_s=1
2026-11-21T17:21:43.766Z info  masscan exited exit_code=0 elapsed_s=3 open_ports_reported=4
2026-11-21T17:21:43.766Z info  scan finished status=completed hosts_up=2 open_ports=3 subnets=2 duration_s=3
2026-11-21T17:21:43.767Z info  result written output=stdout bytes=1282 exit_code=0
```

| Level | What you see |
|---|---|
| `debug` | Everything below, plus the full masscan command line, masscan's own messages (run with `-v`: chosen interface, source IP, router IP and MAC), and every host and open port as it is found |
| `info` | Start, accepted job (addresses, ports, probes, rate, estimated duration), masscan start and exit, progress every `MASSCAN_WORKER_PROGRESS_INTERVAL` seconds (% done, rate, ETA, hosts up so far), summary, result written |
| `warn` | Clamped rate, an estimated duration longer than the time window, a time-window or signal stop, masscan warnings (`masscan: FAIL: …`) |
| `error` | Invalid job, masscan failures, masscan killed after ignoring the stop, a result that could not be written |

`MASSCAN_WORKER_LOG_FORMAT=json` emits one JSON object per line instead (`ts`, `level`, `event`, `msg`, plus the fields), for an orchestrator or a log collector. The `event` names are stable: `worker.start`, `job.accepted`, `job.warning`, `job.window`, `scanner.detected`, `masscan.command`, `scan.started`, `scan.progress`, `masscan.message`, `host.up`, `port.open`, `scan.stopping`, `scan.killing`, `masscan.exited`, `scan.failed`, `scan.finished`, `job.failed`, `result.written`.

Progress comes from masscan's own status line, so `% done` covers masscan's full index space, including the part skipped by `resume_index`.

## Speed

- masscan is the bottleneck, and the worker adds almost nothing on top. Results are parsed as a stream, so memory grows with the number of live hosts, not the number of probes.
- Duration ≈ `addresses × ports / rate + wait_seconds`. For example, a /16 on all ports at 100k pps takes about 12 hours, and a /16 on 20 ports takes about 13 seconds.
- To go faster, raise `rate` (within `MASSCAN_WORKER_MAX_RATE` and what the network can take), or split a job with `shard` across workers on different hosts. Several shards on one NIC share the same bandwidth.
- masscan writes NDJSON through a block-buffered pipe, so results arrive in chunks rather than one by one.

## Safety (PDF, section 2)

- SYN sweep only: no banners, no payloads, no login attempts.
- The rate is always limited: every job gets a rate, and the operator's `MASSCAN_WORKER_MAX_RATE` is a hard cap.
- `MASSCAN_WORKER_MAX_TARGETS` caps how many addresses a single job may cover.
- Every target, port and adapter value is validated and normalized before it reaches masscan. masscan is started with an argument vector (`fork` + `execvp`), never through a shell, and reads its targets from a file it generates (`-iL`).
- The time window is enforced: graceful `SIGINT`, then `SIGKILL` if masscan has not exited `wait_seconds + 10 s` later. masscan runs in its own process group and dies with the worker (`PR_SET_PDEATHSIG`).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `MASSCAN_BINARY` | `masscan` | Path to (or name in `PATH` of) the masscan binary |
| `MASSCAN_WORKER_DEFAULT_RATE` | `10000` | Rate for jobs that do not set one (pps) |
| `MASSCAN_WORKER_MAX_RATE` | `100000` | Hard cap on any job's rate (pps) |
| `MASSCAN_WORKER_MAX_TARGETS` | `16777216` | Maximum addresses per job (a /8) |
| `MASSCAN_WORKER_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `MASSCAN_WORKER_LOG_FORMAT` | `text` | `text` or `json` (one object per line) |
| `MASSCAN_WORKER_PROGRESS_INTERVAL` | `5` | Seconds between progress lines |

[`docker-compose.workers.yml`](../../../docker/docker-compose.workers.yml) passes all `MASSCAN_WORKER_*` variables from your shell into the container, e.g. `MASSCAN_WORKER_LOG_LEVEL=debug pnpm workers:masscan < job.json`.

## Docker image

The image is built and runs on `ubuntu:26.04`, with the distribution's `masscan` and `nlohmann-json3-dev`. The image build compiles with the strict warning flags and runs the unit tests (`ctest`), so `pnpm workers:build` fails if a test fails. CI builds the same image.

If the build fails with `429 Too Many Requests`, Docker Hub is rate-limiting your IP address; a shared network makes this happen quickly. Either run `docker login` with a free Docker account (the limit then counts per account, not per IP), or pull the Ubuntu base image from a mirror:

```bash
UBUNTU_IMAGE=public.ecr.aws/docker/library/ubuntu pnpm workers:build   # AWS mirror of Docker Hub images
UBUNTU_IMAGE=mirror.gcr.io/library/ubuntu pnpm workers:build           # Google mirror
```

masscan has `setcap cap_net_raw,cap_net_admin`, so the worker runs as the non-root `worker` user. The container needs `NET_RAW` / `NET_ADMIN`, which compose grants. Compose also runs it with `network_mode: host`, so masscan uses the host's network card, IP address and router, as if it ran directly on the host. This needs a Linux host; Docker Desktop (macOS/Windows) has no real host network.

masscan cannot scan the IP address of the machine it runs on: it bypasses the kernel, so the host's own services never answer it. Scan the host from another machine.

## Source layout

| File | Responsibility |
|---|---|
| `src/main.cpp` | CLI, reads input, wires everything together, writes the result and exit code |
| `src/scan_job.*` | Validates the input JSON into a `ScanJob` and applies the config limits |
| `src/address.*` | IPv4 / port parsing, range merge and subtraction |
| `src/masscan_runner.*` | Builds masscan's argv, polls masscan's stdout (`-oD` results) and stderr (status line → progress), time window and signal thread, `paused.conf` |
| `src/process.*` | RAII file descriptors, `fork`/`execvp` with its own process group |
| `src/topology.*` | Groups findings into subnets, TTL heuristics |
| `src/report.*` | Result JSON |
| `src/config.*` | Environment variables |
| `src/logger.*` | Leveled text or JSON-lines logging to stderr |
| `tests/unit_tests.cpp` | Framework-free unit tests (`ctest`) |

## Dependencies

- masscan 1.3.2+ (it needs `-oD` NDJSON output)
- nlohmann/json 3.11+ (system package)
