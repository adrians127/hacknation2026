# apps/workers

One directory is one worker: `apps/workers/<name>/`. Masscan, Nmap and httpx wrappers use C++23; Naabu and TLSX use Python 3.

This directory is **not a pnpm workspace** (it has no `package.json`), so turbo skips it and `pnpm build` does not need a local C++ compiler. Workers are built and run in Docker (`pnpm workers:build` and `pnpm workers:masscan` for masscan-worker, `pnpm workers:manager` for worker-manager).

| Worker | Description |
|---|---|
| [`nmap-worker`](nmap-worker/README.md) | TCP service and version detection on address ranges or on Masscan hits (host objects with their own ports) |
| [`httpx-worker`](httpx-worker/README.md) | HTTP/HTTPS probing on assigned IPv4 addresses, ports and domains; enriches the shared result with web response data |
| [`tlsx-worker`](tlsx-worker/README.md) | TLS handshake and certificate collection on assigned IPv4 addresses, ports and SNI names, without HTTP probing |
| [`worker-manager`](worker-manager/README.md) | Orchestrator, not a worker: takes a job list from a file or long-polled from the backend (`--poll`), splits it into tasks, runs the workers (in parallel where their IP:ports do not overlap, in pipeline order where they do), saves their results to files and, with `--poll`, uploads each one to the backend |
| [`masscan-worker`](masscan-worker/README.md) | High-speed TCP SYN sweep across subnets or all 65,535 ports via masscan. JSON job in, JSON list of live hosts out |
| [`naabu-worker`](naabu-worker/README.md) | Alternative TCP discovery sweep via Naabu. Same job and result shape as masscan-worker; supports connect and SYN scans |

## Job and result format

Every worker reads the same job JSON and writes the same result JSON, so worker-manager and the backend handle them alike. A new worker follows this section.

**Job (input):** one object, snake_case keys; unknown keys are ignored (worker-manager adds `task_id`, `task_index`, `task_count`).

| Field | Default | Description |
|---|---|---|
| `job_id`, `scan_id`, `lease_id` | none | Strings, echoed as `scan.jobId`, `scanId`, `leaseId` (`null` when not given) |
| `targets` | required | IPv4 address, CIDR (`10.0.0.0/24`) or range (`10.0.0.1-10.0.0.50`): an array, or one comma-separated string. nmap-worker also takes host objects `{ip, ports, domains}` here |
| `exclude` | `[]` | Same formats as `targets`, subtracted before scanning |
| `ports` | `"1-65535"` | TCP ports: `"22,80,8000-8100"` or `[22, "8000-8100"]` |
| `rate` | worker's default | Packets per second for the whole job |
| `max_duration_seconds` | none | Time window, 1 to 604800 (required by nmap-worker, httpx-worker and tlsx-worker) |

Worker-specific settings are more flat snake_case fields (masscan's `wait_seconds`, nmap's `host_timeout_ms`, …), described in the worker's README. Validation errors use the same wording in every worker.

**Result (output):** exactly `{ "scan": {…}, "hosts": [ … ] }` as in [`docs/worker-result-format.md`](../../docs/worker-result-format.md), in its key order, with no extra top-level keys. Every key is always present: a worker writes `null` (or `[]`) for what it cannot discover. masscan-worker, for example, has `service: null` and `params.hostTimeoutMs: null`, where nmap-worker fills them in.

- Job-level `scan.error.code`: `invalid-input`, `scanner-unavailable`, `scanner-failed` or `io-error`. Host-level codes (`host-timeout`, `nmap-exit`, …) are on `hosts[].error`.
- Invalid input: `status: "failed"`, `stopReason: "error"`, `hosts: []`, ids echoed when readable, `params` all `null` except `nmapArgs: []`, `counts.addresses`, `down` and `cancelled` `null`.
- `params.subnet` is the job's CIDR when its addresses are exactly one aligned block, otherwise `null`; `params.ports` is the normalized port spec.
- CLI and exit codes are shared too: `--input`, `--output`, `--pretty`; `0` completed or partial, `1` failed, `2` invalid input; a result is written in every case, and `SIGTERM` still writes a `partial` result.

## Backend protocol: HTTP pull

Workers have no database access. Only the backend writes to it (Prisma). Each worker:

1. **Lease**: takes a batch of Masscan hits from the backend, grouped by host, with a subnet scope, rate limits, and a deadline.
2. **Scan**: runs Nmap only on the supplied IPs and TCP ports, parses its temporary XML output, and stops when the deadline expires.
3. **Result**: sends results and metrics (duration, host count) back over REST, and the backend adaptively sizes the next batches based on those measurements.
4. **Heartbeat** extends the lease. A lease without a heartbeat expires and the batch returns to the pool.

The Nmap worker sends `WORKER_TOKEN` as a bearer machine token to JSON endpoints described in `packages/contracts` (tag `Workers`). Machine-token validation is separate from user authentication and still needs to be implemented with the backend lease, heartbeat, and result handlers.

worker-manager in `--poll` mode leases whole job lists instead: it long-polls `POST /workers/manager/lease` with the same kind of bearer token, runs what it gets and uploads every worker run's result to `POST /workers/manager/results` (see [its README](worker-manager/README.md#poll-mode-jobs-from-the-backend)). The backend implements both (`WORKER_TOKEN`, [backend README](../backend/README.md#pipelines-scheduling-and-leasing)): the lease registers the manager and the workers it offers, with the capabilities from each worker's `manifest.json` ([worker manifests](worker-manager/README.md#worker-manifests)), and hands out jobs of pipeline runs for those workers. The backend knows no worker by itself. There is no heartbeat endpoint; a lease lasts until the job's deadline plus a grace period.

## Result format (locked)

What a worker returns for a job is fixed in [`docs/worker-result-format.md`](../../docs/worker-result-format.md): a `{ scan, hosts[] }` document with every address of the job, its open ports and service detection where available. The backend builds scan-data features on it. `nmap-worker` fills port and service observations, `httpx-worker` fills HTTP response observations, and `tlsx-worker` fills port-level TLS observations without creating HTTP endpoints. Favicon mapping is still pending.

## Scan jobs in the database

A lease hands out `ScanJob` rows (`apps/backend/prisma/schema/scans/`) of pipeline runs: a pipeline (or a target import with `startScan`, which runs the default steps masscan → nmap) queues a `Scan` and the jobs of its first step; each completed job queues the next step's job from its hits (see [the backend README](../backend/README.md#pipelines-scheduling-and-leasing)). The lease and result handlers read and update those rows.

| `ScanJob` field | Meaning |
|---|---|
| `scanId`, `sequence` | The run it belongs to and its position (1..`Scan.jobCount`; later steps' jobs are numbered as they are created) |
| `stepIndex`, `worker` | The pipeline step that created it, and the worker-manager worker that runs it (`jobs[].worker`) |
| `kind` | `discovery` (a step over the targets) or `service` (a step over the previous step's hits) |
| `params` | The worker's job as sent in `jobs[].params`: `targets` (CIDRs/IPs, or `{ip, ports, domains}` host objects), `ports`, `rate` and the worker's own fields; `max_duration_seconds` is added at lease time |
| `status` | `queued` → `leased` → `completed` / `failed`, or `stopped`; an expired lease goes back to `queued` |
| `subnet` | The smallest aligned IPv4 CIDR containing the whole batch, ready for `NmapJob.subnet` |
| `targets` | IPv4 addresses and CIDRs inside `subnet`, at most `Scan.batchSize` addresses in total (256 by default, never above 1024, the `NmapJob` limit) |
| `hosts` | `[{ ip, domain }]` for domains the backend resolved into this batch (one IP may appear under several domains) |
| `attempts`, `leaseId`, `leasedBy`, `leaseExpiresAt`, `heartbeatAt` | Lease bookkeeping; the `(status, leaseExpiresAt)` index serves the lease query |
| `startedAt`, `finishedAt`, `durationMs`, `error` | Timing for adaptive batch sizing, and the last failure |

The parent `Scan` snapshots the run's steps (`steps`), its time window (`windowEndsAt`) and, for ingest's checks, the union of the steps' ports (`ports`) and their highest rate (`maxRate`).

Settled questions:

- ~~Which worker consumes the `discovery` jobs?~~ The pipeline decides; the default steps (target import) are Masscan over `targets`, then Nmap on the host objects built from its hits.
- ~~`NmapJob.targets` rejects duplicate IPs, but `hosts` can list one IP under two domains.~~ Settled by the [result format](../../docs/worker-result-format.md#what-the-job-must-provide): the job lists each IP once with all its domains, and the worker fingerprints HTTP once per domain.

## Scan safety (PDF requirement)

Scans must be **safe**: detection only, no exploitation and no login attempts. The rate must be limited (`--max-rate`, `--scan-delay`, timing), a scan may only cover the ports and ranges allowed by the configuration, and it is stopped once the time window is exceeded.
