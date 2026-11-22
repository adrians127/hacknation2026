# worker-manager

A **C++23** orchestrator for the scan workers. It takes a **job list**, from a file (`--input`) or long-polled from the backend (`--poll`), splits every job into **tasks**, runs one independent worker process per task and saves every worker result to files. Tasks on disjoint `IP:port`s run in parallel; tasks sharing one run one after another, in pipeline order (see [Scheduling](#scheduling-what-may-run-in-parallel)).

It runs **masscan-worker** or **naabu-worker** (discovery), then **nmap-worker** (service detection) and **httpx-worker** (HTTP/HTTPS response probing), in pipeline order wherever their `IP:port`s overlap. The job list must provide each stage's targets; the manager does not derive later jobs from earlier results.

With `--poll` it works against the backend: it asks for job lists, runs them and uploads every task's result (one `task-NNN.result.json` = one upload) as soon as that task finishes. Heartbeats are the next step.

## Run (Docker)

From the repo root:

```bash
pnpm workers:manager                     # build the image, run examples/example.json
pnpm workers:manager --input /jobs/my-jobs.json --output-dir /results
WORKER_MANAGER_MAX_PARALLEL=4 MASSCAN_WORKER_LOG_LEVEL=debug pnpm workers:manager
WORKER_TOKEN=… pnpm workers:manager:poll  # long-poll the backend (localhost:3001) until Ctrl+C
```

`pnpm workers:manager` is `docker compose -f docker/docker-compose.workers.yml run --rm --build worker-manager` (service in the `cli` profile). Compose mounts:

| Host | Container | |
|---|---|---|
| `apps/workers/worker-manager/examples/` | `/jobs` (read-only) | Job lists. Edit [`examples/example.json`](examples/example.json) or drop new files here; no rebuild needed |
| `worker-results/` (repo root) | `/results` | Output, one subdirectory per run |

**Edit the targets in `example.json` first** (it scans `192.168.1.0/24`); scan only networks you are allowed to scan. The container runs as `${WORKER_UID:-1000}:${WORKER_GID:-1000}`; `pnpm workers:manager` creates `worker-results/` and sets both to your own uid/gid, so the result files belong to you. With plain `docker compose`, set them yourself. `Permission denied` on `/results` means the folder belongs to someone else (often root, when Docker created it): `sudo chown -R "$(id -u):$(id -g)" worker-results`. Like masscan-worker it uses `network_mode: host` and `NET_RAW`/`NET_ADMIN` (Linux hosts only).

The image is built from `apps/workers/` and contains `worker-manager`, `masscan-worker`, `naabu-worker`, `nmap-worker`, `httpx-worker` and their scanner binaries. The four C++ projects' tests and Naabu's Python tests run during the image build. The default example has two masscan jobs and one nmap job; [`examples/httpx-local.json`](examples/httpx-local.json) exercises the HTTP worker.
[`examples/naabu-nmap-local.json`](examples/naabu-nmap-local.json) runs Naabu followed by Nmap on loopback. Use `pnpm workers:manager --input /jobs/naabu-nmap-local.json --output-dir /results` after building. The worker-manager image also contains `naabu-worker` and Naabu.

## CLI

```
worker-manager (--input FILE | --poll) [--output-dir DIR]
```

| Flag | Default | Description |
|---|---|---|
| `--input` | one of the two | Run one job list JSON (`-` for stdin), then exit |
| `--poll` | one of the two | Long-poll the backend for job lists and run each one, until `SIGINT`/`SIGTERM`. See [Poll mode](#poll-mode-jobs-from-the-backend) |
| `--output-dir` | `results` | Base directory. Every job list (run) creates `<DIR>/<run-id>/` (`20261121T170000Z`) |

| Exit code | `--input` | `--poll` |
|---|---|---|
| `0` | Every job `completed` or `partial` | Stopped by `SIGINT`/`SIGTERM` (the normal way to end it) |
| `1` | At least one job `failed` | |
| `2` | Invalid input (not JSON, no `jobs[]`), invalid configuration or usage | Invalid configuration (no `WORKER_MANAGER_TOKEN`, no worker binary) or usage |
| `130` | Stopped by `SIGINT`/`SIGTERM` | |

`SIGINT`/`SIGTERM` (Ctrl+C, `docker stop`): running workers get `SIGTERM` and write a `partial` result, queued tasks are `cancelled`, and the summaries are still written. A second signal kills the workers. In poll mode a pending lease request is abandoned within about a second.

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
| `jobs[].params` | yes | The worker's job, in the [shared job format](../README.md#job-and-result-format) plus the worker's own fields. `params.rate` (packets per second) caps the whole job; see [Rate budget](#rate-budget) (for masscan: [its input table](../masscan-worker/README.md#input)). The manager reads it only where `split` needs it |

Jobs run in the order of `jobs[]`; there is no priority (a `priority` field is ignored). `next_poll_ms` is used by [poll mode](#poll-mode-jobs-from-the-backend); other fields (`lease_expires_at`, `heartbeat_interval_s`, `server_time`) are accepted and ignored until heartbeats exist. An invalid job does not stop the others: it is reported as `failed` with `invalid-job`.

### Split strategies

| `strategy` | Splits | Each task gets |
|---|---|---|
| `none` | nothing | the job as is |
| `shard` | the scan space, via masscan `--shards` | the same `seed` (the job's, or a generated one) and `shard: {index, total}` |
| `ranges` | `params.targets` minus `params.exclude`, into contiguous address blocks of near-equal size | its block as `targets`, `exclude: []` (already subtracted) |
| `chunk` | the `params.targets` array (e.g. nmap-worker's host objects) | a slice of `targets` |

- **Task count:** `ceil(items / max_items_per_task)` when `max_items_per_task` is set, otherwise `max_tasks` (default `WORKER_MANAGER_MAX_PARALLEL`). It is never above `max_tasks`, `WORKER_MANAGER_MAX_TASKS_PER_JOB` or the number of items.
- **Rate:** the planner does not touch it. The tasks of one job share the job's `rate` (see [Rate budget](#rate-budget)), so splitting never multiplies the packet rate. On one machine a single masscan already reaches the full rate, so `shard` mainly pays off once tasks go to several hosts; `ranges` gives smaller tasks that finish (and free their `IP:port`s) sooner.
- A job whose params already carry `shard` or `resume_index` is never split (masscan's resume point belongs to one exact job), with a warning.

## Poll mode: jobs from the backend

With `--poll` the manager asks the backend for work over HTTP instead of reading a file:

1. `POST <WORKER_MANAGER_BACKEND_URL>/workers/manager/lease` with `Authorization: Bearer <WORKER_MANAGER_TOKEN>` and the body below. The backend may hold the request for up to `wait_seconds` until it has work (long poll).
2. `200` with a job list in the [input format](#input-the-job-list): the manager runs it to the end, as `--input` does, into its own `<run-id>/` directory, and saves the response there as `lease.json`. `204`, or `200` with `jobs: []`, means no work.
3. It asks again, after the response's `next_poll_ms` if the backend set one (at most 5 minutes).

```json
{ "manager_id": "scan-host-1", "version": "0.1.0", "workers": ["masscan", "naabu", "nmap", "httpx"], "max_parallel": 2, "wait_seconds": 30 }
```

| Field | Meaning |
|---|---|
| `manager_id` | `WORKER_MANAGER_ID` (default: the hostname), for the backend's `ScanJob.leasedBy` |
| `workers` | Workers whose binary is installed; the backend should hand out jobs only for these |
| `max_parallel` | Worker processes the manager runs at once, a hint for sizing the list |
| `wait_seconds` | `WORKER_MANAGER_POLL_WAIT`: how long the backend may hold the request. The manager gives up 15 s after that |

- **Only an idle manager asks.** The next request goes out once the whole job list has finished, so leased jobs never sit in a local queue while their lease runs out. The backend should hand out about as much as the manager can finish within one lease.
- **Failures** (connection error, timeout, a status other than 200/204, a body that is not a job list) are logged as `lease.failed` / `lease.invalid` and retried after `WORKER_MANAGER_RETRY_DELAY` seconds, doubled per failure in a row up to 60 s. `401`/`403` are reported as a rejected token. A backend that answers `204` at once instead of holding the request is still asked at most once a second.
- **Not done yet:** heartbeats. Until then the backend's leases simply expire, and it has to put jobs whose results never arrived back in the queue.
- **Backend side** ([backend README](../../backend/README.md#pipelines-scheduling-and-leasing)): the request registers the manager and its `workers` in the backend's worker registry (unknown names as disabled workers). One `ScanJob` row of a pipeline run becomes one `jobs[]` entry: `job_id` = `ScanJob.id`, `scan_id`, a new `lease_id` per lease, `worker` = the step's worker, `split` = the step's split, `deadline` = the step's time limit cut at the scan's time window, and `params` = `ScanJob.params` (`targets`, `ports`, `rate`, the worker's own fields) plus `max_duration_seconds`. Only workers an admin enabled are handed out, at most `max_parallel` × `WORKER_LEASE_JOBS_PER_SLOT` jobs per request.

### Result upload

Every task that leaves a result file is uploaded on its own, as soon as it finishes, by one uploader thread (the worker pool never waits for the backend):

```
POST <WORKER_MANAGER_BACKEND_URL>/workers/manager/results      Authorization: Bearer <WORKER_MANAGER_TOKEN>
{ "task_index": 2, "task_count": 3, "result": { "scan": {…}, "hosts": […] } }
```

- **One worker run, one result.** `result` is the worker's `task-NNN.result.json`, unchanged (the [shared result format](../README.md#job-and-result-format)). The tasks of a split job all carry the job's `job_id` and `lease_id`; `task_index` tells them apart, and the backend stores each as a separate result of the scan (`scan_id`). A resend of the same lease and task is a no-op on the backend (`"status": "duplicate"`).
- **Retries:** connection errors, timeouts, `408`, `429` and `5xx` are retried after `WORKER_MANAGER_RETRY_DELAY` seconds, doubled per attempt up to 60 s, at most `WORKER_MANAGER_UPLOAD_ATTEMPTS` times. Any other status (`400` validation, `401` token, `404` unknown job, `413` too large) is final: the upload is `rejected`, with the backend's error message.
- **A job list is done when its uploads are.** The next lease request waits until every result is uploaded or given up, so a down backend slows polling instead of piling up results.
- **Given up or rejected** results stay on disk in `<run-id>/`; nothing resends them later. The task's `upload` block in `job.json` says what happened: `status` (`uploaded`, `rejected`, `failed`), `attempts`, `httpStatus`, the backend's `resultId`, `duplicate` and `error`; `counts.uploaded` / `counts.notUploaded` sum them up (also in `run.json`).
- **Stopping:** after the first `SIGINT`/`SIGTERM` every pending result (the workers' `partial` results included) gets one more attempt without waiting; the second signal aborts uploads in flight.
- Tasks without a result file (the worker could not start, crashed without writing one, or was cancelled) upload nothing. `--input` never uploads.

## Scheduling: what may run in parallel

Running everything in parallel is not always right. Two workers probing the same `IP:port` at the same time double the load on that host, can trip its IDS or rate limits and can disturb each other's results, and some workers must run in order (discovery before service detection). So the manager decides per task, from **which IPs and ports it touches**:

1. **Footprint.** Each task's input is read as a set of `(IPv4, TCP port)` pairs: `targets` minus `exclude`, times `ports` (default `1-65535`, as masscan). Host objects in `targets` (`{ip, ports}`, nmap-worker) give per-host ports. A task whose input cannot be read gets the footprint "everything", so it runs alone (with a warning).
2. **Conflict.** Two tasks that share at least one `IP:port` never run at the same time. The same IP on other ports, or other IPs, run in parallel. Shards of one job are exempt: masscan already splits the probe space between them. Tasks from a `ranges` or `chunk` split are disjoint by construction.
3. **Order.** `WORKER_MANAGER_STAGES` (default `masscan,naabu,nmap,httpx`) is the pipeline. A task of a later stage starts only after **every overlapping task of an earlier stage has finished**, even when it is ahead in the queue. Tasks with no overlap are not ordered, and a worker not listed in the stages is never ordered (only conflicts apply to it).
4. **Queue order.** Tasks are taken in the order of `jobs[]` (then task order). A task blocked by 2. or 3. is skipped, so work on other `IP:port`s does not wait behind it.

A held-back task is logged once with the reason (`task held back task_id=svc/1 reason="waits for earlier-stage task a/1 on the same IPs and ports"`), and each task's `job.json` entry has a `schedule` block: its `stage`, its `footprint` (`exact`, `addresses`, `areas`) and `after`, the earlier-stage tasks it waited for.

## Worker contract

Every worker is an independent binary with the same interface, so the manager needs no worker-specific code beyond `split`:

- `<binary> --input FILE --output FILE`; logs on stderr; a result JSON written **in every case**.
- `SIGTERM` stops the scan and still writes a `partial` result (the manager signals the worker's whole process group).
- Input: the job's `params` plus a common envelope, `job_id`, `scan_id`, `lease_id`, `task_id` (`<job_id>/<index>`), `task_index`, `task_count`, `rate` (the packets per second the scheduler granted; the worker must not exceed it) and `max_duration_seconds` (from the job's `deadline`, at most 7 days). Workers ignore fields they do not know.
- Output: the shared result schema ([job and result format](../README.md#job-and-result-format), [`docs/worker-result-format.md`](../../../docs/worker-result-format.md)). The manager reads `scan.status` (`completed` / `partial` / `failed`), `scan.error` and `scan.counts`.
- The worker enforces `max_duration_seconds` itself. As a backstop the manager sends `SIGTERM` once a task overruns it by `WORKER_MANAGER_KILL_GRACE`, and `SIGKILL` 10 s later.

## Output

```
worker-results/20261121T170000Z/
├── run.json                    # run summary: status, stopReason, counts, one line per job
├── lease.json                  # --poll only: the job list as the backend sent it
└── lan-common-ports/           # one directory per job (job_id)
    ├── job.json                # job summary: status, error, warnings, counts, tasks[]
    ├── task-001.input.json     # exactly what the worker got
    ├── task-001.result.json    # the worker's result, unchanged (what --poll uploads)
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
| `WORKER_MANAGER_WORKERS` | `masscan=masscan-worker,naabu=naabu-worker,nmap=nmap-worker,httpx=httpx-worker` | `name=binary` pairs, comma-separated. A binary without `/` is looked up in `PATH` |
| `WORKER_MANAGER_STAGES` | `masscan,naabu,nmap,httpx` | Pipeline order of the workers; on overlapping `IP:port`s a later one waits for the earlier ones. See [Scheduling](#scheduling-what-may-run-in-parallel) |
| `WORKER_MANAGER_MAX_RATE` | `100000` | Packets per second for all running tasks together, see [Rate budget](#rate-budget). masscan-worker still clamps to its own `MASSCAN_WORKER_MAX_RATE` |
| `WORKER_MANAGER_WORKER_MAX_RATE` | `nmap=100,httpx=25` | Per-worker rate caps. For Nmap, 100 is `NMAP_MAX_PARALLEL × NMAP_MAX_RATE_PER_PROCESS` (2 × 50); httpx interprets its grant as HTTP requests per second |
| `WORKER_MANAGER_MIN_TASK_RATE` | `1000` | A task does not start with a smaller share (unless its job's `rate` is smaller) |
| `WORKER_MANAGER_MAX_PARALLEL` | `2` | Worker processes running at once, across all jobs (an upper bound; overlapping tasks run one after another) |
| `WORKER_MANAGER_MAX_TASKS_PER_JOB` | `16` | Hard cap on how far one job is split |
| `WORKER_MANAGER_DEADLINE_MARGIN` | `10` | Seconds kept free before a job's `deadline` (the worker's own stop needs `wait_seconds` and some slack) |
| `WORKER_MANAGER_KILL_GRACE` | `30` | Seconds a task may overrun its `max_duration_seconds` before the manager stops it |
| `WORKER_MANAGER_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `WORKER_MANAGER_LOG_FORMAT` | `text` | `text` or `json` (worker lines become `worker.output` events) |
| `WORKER_MANAGER_BACKEND_URL` | `http://localhost:3001/v1` | `--poll`: the backend's base URL, `http://` or `https://`. Compose takes it from `BACKEND_URL` |
| `WORKER_MANAGER_TOKEN` | none | `--poll`: bearer machine token, required. Compose takes it from `WORKER_TOKEN` |
| `WORKER_MANAGER_ID` | the hostname | `--poll`: `manager_id` of every lease request; `A-Z a-z 0-9 . _ -`, at most 128 characters |
| `WORKER_MANAGER_POLL_WAIT` | `30` | `--poll`: seconds the backend may hold one lease request (1 to 300) |
| `WORKER_MANAGER_RETRY_DELAY` | `5` | `--poll`: seconds before retrying a failed lease request or upload, doubled per failure in a row up to 60 (1 to 3600) |
| `WORKER_MANAGER_UPLOAD_ATTEMPTS` | `5` | `--poll`: attempts per result before it is left on disk (1 to 100) |

Workers inherit the manager's environment, so `MASSCAN_WORKER_*` and `NMAP_*` variables reach every worker. Compose sets `NMAP_SCAN_TYPE=syn` and `NMAP_PRIVILEGED=1`, as for the standalone nmap-worker.

## Build and test without Docker

```bash
cmake --preset release && cmake --build --preset release && ctest --test-dir build/release --output-on-failure
```

Needs GCC 14+ (`<print>`), CMake 3.28+, Ninja, nlohmann/json 3.11+ and libcurl (`libcurl4-openssl-dev`). `ctest` runs the unit tests and an end-to-end test that drives the real binary with [`tests/fake-worker.sh`](tests/fake-worker.sh), so it needs neither masscan nor root. When `python3` is installed it also runs `e2e-poll`: `--poll` against [`tests/fake-backend.py`](tests/fake-backend.py) (a retried `500` lease, a job list, one upload per task with a retried `503` and a rejected `400`, then a `SIGTERM` during a held request).

## Source layout

| File | Responsibility |
|---|---|
| `src/main.cpp` | CLI, the poll loop, planning every job, the thread pool, signal thread, `job.json` / `run.json` |
| `src/backend_client.*` | Poll mode: the lease and upload requests, response statuses, `next_poll_ms`, retry backoff |
| `src/result_uploader.*` | The uploader thread: a queue of finished tasks' results, retries, the `upload` outcome per task |
| `src/http_client.*` | libcurl JSON POST that a stop request cuts short |
| `src/job.*` | Parses and validates the job list |
| `src/planner.*` | Splits a job into tasks (`none`, `shard`, `ranges`, `chunk`) |
| `src/footprint.*` | The `IP:port` pairs a task touches, port specs, overlap test |
| `src/scheduler.*` | Which task may start and at what rate: conflicts, stage order, queue order, rate budget |
| `src/ipv4.*` | IPv4 specs, range merge/subtract/split |
| `src/task_runner.*` | Runs one worker: input file, log passthrough, deadline, watchdog, reading the result |
| `src/process.*` | RAII file descriptors, `fork`/`execvp` in its own process group |
| `src/files.*`, `src/config.*`, `src/logger.*` | Atomic JSON writes and `PATH` lookup, environment, logging |
