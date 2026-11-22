# worker-manager

A **C++23** orchestrator for the scan workers. It takes a **job list** (the format the backend's lease endpoint will return), splits every job into **tasks**, runs one independent worker process per task and saves every worker result to files. Tasks on disjoint `IP:port`s run in parallel; tasks sharing one run one after another, in pipeline order (see [Scheduling](#scheduling-what-may-run-in-parallel)).

It runs **masscan-worker** (discovery) and **nmap-worker** (service detection on the hosts and ports masscan found), masscan first wherever their `IP:port`s overlap.

For now it has **no backend connection**: the job list comes from a file and results go to disk. The long poll, heartbeats and forwarding results to the backend are the next step; the file layout below is already shaped for that (one `task-NNN.result.json` = one result to forward).

## Run (Docker)

From the repo root:

```bash
pnpm workers:manager                     # build the image, run examples/example.json
pnpm workers:manager --input /jobs/my-jobs.json --output-dir /results
WORKER_MANAGER_MAX_PARALLEL=4 MASSCAN_WORKER_LOG_LEVEL=debug pnpm workers:manager
```

`pnpm workers:manager` is `docker compose -f docker/docker-compose.workers.yml run --rm --build worker-manager` (service in the `cli` profile). Compose mounts:

| Host | Container | |
|---|---|---|
| `apps/workers/worker-manager/examples/` | `/jobs` (read-only) | Job lists. Edit [`examples/example.json`](examples/example.json) or drop new files here; no rebuild needed |
| `worker-results/` (repo root) | `/results` | Output, one subdirectory per run |

**Edit the targets in `example.json` first** (it scans `192.168.1.0/24`); scan only networks you are allowed to scan. The container runs as `${WORKER_UID:-1000}:${WORKER_GID:-1000}` so result files belong to you; set both if your uid is not 1000. Like masscan-worker it uses `network_mode: host` and `NET_RAW`/`NET_ADMIN` (Linux hosts only).

The image is built from `apps/workers/` and contains `worker-manager`, `masscan-worker`, `nmap-worker`, `masscan` and `nmap`. All three projects' tests run during the image build. The example has two masscan jobs and one nmap job; nmap job ids (`job_id`, `scan_id`) must be UUIDs, as the result contract requires.

## CLI

```
worker-manager --input FILE [--output-dir DIR]
```

| Flag | Default | Description |
|---|---|---|
| `--input` | required | Job list JSON, `-` for stdin |
| `--output-dir` | `results` | Base directory. Every run creates `<DIR>/<run-id>/` (`20261121T170000Z`) |

| Exit code | Meaning |
|---|---|
| `0` | Every job `completed` or `partial` |
| `1` | At least one job `failed` |
| `2` | Invalid input (not JSON, no `jobs[]`), invalid configuration or usage |
| `130` | Stopped by `SIGINT`/`SIGTERM` |

`SIGINT`/`SIGTERM` (Ctrl+C, `docker stop`): running workers get `SIGTERM` and write a `partial` result, queued tasks are `cancelled`, and the summaries are still written. A second signal kills the workers.

## Input: the job list

```json
{
  "schema_version": 1,
  "jobs": [
    {
      "job_id": "lan-common-ports",
      "scan_id": "0193a0f2-1b2c-7d3e-8f40-516273849506",
      "lease_id": "0193a1ab-0d4e-7f60-a1b2-c3d4e5f60718",
      "deadline": "2026-11-21T17:30:00Z",
      "worker": "masscan",
      "split": { "strategy": "shard", "max_tasks": 2 },
      "params": { "targets": ["192.168.1.0/24"], "ports": [22, 80, 443], "rate": 2000 }
    }
  ]
}
```

| Field | Required | Description |
|---|---|---|
| `schema_version` | no | `1` if present |
| `jobs[].job_id` | yes | Unique in the list. Becomes a directory name: `A-Z a-z 0-9 . _ -`, at most 128 characters |
| `jobs[].scan_id`, `lease_id` | no | Passed to the worker, which echoes them in its result |
| `jobs[].worker` | yes | Which worker runs it; a name from `WORKER_MANAGER_WORKERS` |
| `jobs[].deadline` | no | UTC timestamp. Each task gets `max_duration_seconds = deadline − now − WORKER_MANAGER_DEADLINE_MARGIN` (or the job's own, if smaller); a task that would start after it fails with `deadline-exceeded` |
| `jobs[].split` | no | How to split the job, below. Default `{"strategy": "none"}` |
| `jobs[].params` | yes | The worker's own input. `params.rate` (packets per second) caps the whole job; see [Rate budget](#rate-budget) (for masscan: [its input table](../masscan-worker/README.md#input)). The manager reads it only where `split` needs it |

Jobs run in the order of `jobs[]`; there is no priority (a `priority` field is ignored). Other fields (`lease_expires_at`, `heartbeat_interval_s`, `server_time`, `next_poll_ms`) are accepted and ignored until the backend connection exists. An invalid job does not stop the others: it is reported as `failed` with `invalid-job`.

### Split strategies

| `strategy` | Splits | Each task gets |
|---|---|---|
| `none` | nothing | the job as is |
| `shard` | the scan space, via masscan `--shards` | the same `seed` (the job's, or a generated one) and `shard: {index, total}` |
| `ranges` | `params.targets` minus `params.exclude`, into contiguous address blocks of near-equal size | its block as `targets`, `exclude: []` (already subtracted) |
| `chunk` | the `params.targets` array (e.g. nmap's host list) | a slice of `targets` |

- **Task count:** `ceil(items / max_items_per_task)` when `max_items_per_task` is set, otherwise `max_tasks` (default `WORKER_MANAGER_MAX_PARALLEL`). It is never above `max_tasks`, `WORKER_MANAGER_MAX_TASKS_PER_JOB` or the number of items.
- **Rate:** the planner does not touch it. The tasks of one job share the job's `rate` (see [Rate budget](#rate-budget)), so splitting never multiplies the packet rate. On one machine a single masscan already reaches the full rate, so `shard` mainly pays off once tasks go to several hosts; `ranges` gives smaller tasks that finish (and free their `IP:port`s) sooner.
- A job whose params already carry `shard` or `resume_index` is never split (masscan's resume point belongs to one exact job), with a warning.

## Scheduling: what may run in parallel

Running everything in parallel is not always right. Two workers probing the same `IP:port` at the same time double the load on that host, can trip its IDS or rate limits and can disturb each other's results, and some workers must run in order (discovery before service detection). So the manager decides per task, from **which IPs and ports it touches**:

1. **Footprint.** Each task's input is read as a set of `(IPv4, TCP port)` pairs: `targets` minus `exclude`, times `ports` (default `1-65535`, as masscan). nmap-style targets `[{ip, tcp_ports}]` give per-host ports. A task whose input cannot be read gets the footprint "everything", so it runs alone (with a warning).
2. **Conflict.** Two tasks that share at least one `IP:port` never run at the same time. The same IP on other ports, or other IPs, run in parallel. Shards of one job are exempt: masscan already splits the probe space between them. Tasks from a `ranges` or `chunk` split are disjoint by construction.
3. **Order.** `WORKER_MANAGER_STAGES` (default `masscan,nmap`) is the pipeline. A task of a later stage starts only after **every overlapping task of an earlier stage has finished**, even when it is ahead in the queue. Tasks with no overlap are not ordered, and a worker not listed in the stages is never ordered (only conflicts apply to it).
4. **Queue order.** Tasks are taken in the order of `jobs[]` (then task order). A task blocked by 2. or 3. is skipped, so work on other `IP:port`s does not wait behind it.

A held-back task is logged once with the reason (`task held back task_id=svc/1 reason="waits for earlier-stage task a/1 on the same IPs and ports"`), and each task's `job.json` entry has a `schedule` block: its `stage`, its `footprint` (`exact`, `addresses`, `areas`) and `after`, the earlier-stage tasks it waited for.

## Worker contract

Every worker is an independent binary with the same interface, so the manager needs no worker-specific code beyond `split`:

- `<binary> --input FILE --output FILE`; logs on stderr; a result JSON written **in every case**.
- `SIGTERM` stops the scan and still writes a `partial` result (the manager signals the worker's whole process group).
- Input: the job's `params` plus a common envelope, `job_id`, `scan_id`, `lease_id`, `task_id` (`<job_id>/<index>`), `task_index`, `task_count`, `rate` (the packets per second the scheduler granted; the worker must not exceed it) and `max_duration_seconds` (from the job's `deadline`, at most 7 days). Workers ignore fields they do not know.
- Output: the shared result format of [`docs/worker-result-format.md`](../../../docs/worker-result-format.md). The manager reads `scan.status` (`completed` / `partial` / `failed`), `scan.error` and `scan.counts`.
- The worker enforces `max_duration_seconds` itself. As a backstop the manager sends `SIGTERM` once a task overruns it by `WORKER_MANAGER_KILL_GRACE`, and `SIGKILL` 10 s later.

## Output

```
worker-results/20261121T170000Z/
├── run.json                    # run summary: status, stopReason, counts, one line per job
└── lan-common-ports/           # one directory per job (job_id)
    ├── job.json                # job summary: status, error, warnings, counts, tasks[]
    ├── task-001.input.json     # exactly what the worker got
    ├── task-001.result.json    # the worker's result, unchanged (what goes to the backend later)
    ├── task-001.log            # the worker's stderr
    └── task-002.…
```

The worker logs are also passed through to the manager's stderr, prefixed with the task: `[lan-common-ports/1] … masscan started pid=…`.

Statuses: a task is `completed`, `partial`, `failed` or `cancelled` (never started because of a stop). A job (and the run) is `completed` when all its tasks are, `cancelled` when all were cancelled, `partial` when at least one task produced a usable result, otherwise `failed`. Error codes the manager adds: `invalid-job`, `unsupported-worker`, `worker-unavailable`, `deadline-exceeded`, `no-result`, `io-error`.

## Rate budget

`WORKER_MANAGER_MAX_RATE` is one packet budget (packets per second) for everything the manager runs at once. The scheduler hands it out in queue order and writes each task's share into its input as `rate`:

- The first ready task takes **all it may**: its job's `params.rate` if set (the cap for all tasks of that job together) and its worker's `WORKER_MANAGER_WORKER_MAX_RATE`, otherwise **everything that is free**.
- The next task gets what is left, and so on. A task needs at least `WORKER_MANAGER_MIN_TASK_RATE` (or its job's `rate`, if lower) to start.
- If the first ready task in the queue cannot get that minimum, the free budget is **kept for it**: tasks behind it do not take it. When a task finishes, its share goes back to the pool and the queue moves on.
- A running task keeps the rate it started with (masscan cannot change it mid-scan).

Example with a budget of 1000: job `x` without a rate starts at 1000; `y` (`rate: 400`) and `z` (`rate: 300`) wait (`task held back … waits for rate budget (0 of 1000 pps free)`), and start together at 400 and 300 when `x` finishes. The granted rate is in the `task.started` log line (`rate_pps`) and in `job.json` (`schedule.rate`).

## Configuration

| Variable | Default | Description |
|---|---|---|
| `WORKER_MANAGER_WORKERS` | `masscan=masscan-worker` | `name=binary` pairs, comma-separated. A binary without `/` is looked up in `PATH`. The image sets `masscan=/usr/local/bin/masscan-worker,nmap=/usr/local/bin/nmap-worker` |
| `WORKER_MANAGER_STAGES` | `masscan,nmap` | Pipeline order of the workers; on overlapping `IP:port`s a later one waits for the earlier ones. See [Scheduling](#scheduling-what-may-run-in-parallel) |
| `WORKER_MANAGER_MAX_RATE` | `100000` | Packets per second for all running tasks together, see [Rate budget](#rate-budget). masscan-worker still clamps to its own `MASSCAN_WORKER_MAX_RATE` |
| `WORKER_MANAGER_WORKER_MAX_RATE` | `nmap=100` | `name=pps` pairs: the most a worker can use, so its tasks never reserve more of the budget. For nmap-worker that is `NMAP_MAX_PARALLEL × NMAP_MAX_RATE_PER_PROCESS` (2 × 50) |
| `WORKER_MANAGER_MIN_TASK_RATE` | `1000` | A task does not start with a smaller share (unless its job's `rate` is smaller) |
| `WORKER_MANAGER_MAX_PARALLEL` | `2` | Worker processes running at once, across all jobs (an upper bound; overlapping tasks run one after another) |
| `WORKER_MANAGER_MAX_TASKS_PER_JOB` | `16` | Hard cap on how far one job is split |
| `WORKER_MANAGER_DEADLINE_MARGIN` | `10` | Seconds kept free before a job's `deadline` (the worker's own stop needs `wait_seconds` and some slack) |
| `WORKER_MANAGER_KILL_GRACE` | `30` | Seconds a task may overrun its `max_duration_seconds` before the manager stops it |
| `WORKER_MANAGER_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `WORKER_MANAGER_LOG_FORMAT` | `text` | `text` or `json` (worker lines become `worker.output` events) |

Workers inherit the manager's environment, so `MASSCAN_WORKER_*` and `NMAP_*` variables reach every worker. Compose sets `NMAP_SCAN_TYPE=syn` and `NMAP_PRIVILEGED=1`, as for the standalone nmap-worker.

## Build and test without Docker

```bash
cmake --preset release && cmake --build --preset release && ctest --test-dir build/release --output-on-failure
```

Needs GCC 14+ (`<print>`), CMake 3.28+, Ninja and nlohmann/json 3.11+. `ctest` runs the unit tests and an end-to-end test that drives the real binary with [`tests/fake-worker.sh`](tests/fake-worker.sh), so it needs neither masscan nor root.

## Source layout

| File | Responsibility |
|---|---|
| `src/main.cpp` | CLI, planning every job, the thread pool, signal thread, `job.json` / `run.json` |
| `src/job.*` | Parses and validates the job list |
| `src/planner.*` | Splits a job into tasks (`none`, `shard`, `ranges`, `chunk`) |
| `src/footprint.*` | The `IP:port` pairs a task touches, port specs, overlap test |
| `src/scheduler.*` | Which task may start and at what rate: conflicts, stage order, queue order, rate budget |
| `src/ipv4.*` | IPv4 specs, range merge/subtract/split |
| `src/task_runner.*` | Runs one worker: input file, log passthrough, deadline, watchdog, reading the result |
| `src/process.*` | RAII file descriptors, `fork`/`execvp` in its own process group |
| `src/files.*`, `src/config.*`, `src/logger.*` | Atomic JSON writes and `PATH` lookup, environment, logging |
