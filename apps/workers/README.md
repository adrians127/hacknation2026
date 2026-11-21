# apps/workers

Scanning workers written in **C++**. One directory is one worker: `apps/workers/<name>/` with its own `CMakeLists.txt`, `CMakePresets.json`, `Dockerfile` and `README.md`.

This directory is **not a pnpm workspace** (it has no `package.json`), so turbo skips it and `pnpm build` does not need a local C++ compiler. Workers are built and run in Docker (`pnpm workers:build`, `pnpm workers:masscan`, both masscan-worker only for now), and CI compiles every image.

| Worker | Description |
|---|---|
| [`nmap-worker`](nmap-worker/README.md) | TCP service and version detection on Masscan hits |
| [`masscan-worker`](masscan-worker/README.md) | High-speed TCP SYN sweep across subnets or all 65,535 ports via masscan. JSON job in, JSON topology of live hosts out |

## Backend protocol: HTTP pull

Workers have no database access. Only the backend writes to it (Prisma). Each worker:

1. **Lease**: takes a batch of Masscan hits from the backend, grouped by host, with a subnet scope, rate limits, and a deadline.
2. **Scan**: runs Nmap only on the supplied IPs and TCP ports, parses its temporary XML output, and stops when the deadline expires.
3. **Result**: sends results and metrics (duration, host count) back over REST, and the backend adaptively sizes the next batches based on those measurements.
4. **Heartbeat** extends the lease. A lease without a heartbeat expires and the batch returns to the pool.

The Nmap worker sends `WORKER_TOKEN` as a bearer machine token to JSON endpoints described in `packages/contracts` (tag `Workers`). Machine-token validation is separate from user authentication and still needs to be implemented with the backend lease, heartbeat, and result handlers.

## Result format (locked)

What a worker returns for a job is fixed in [`docs/worker-result-format.md`](../../docs/worker-result-format.md): a `{ scan, hosts[] }` document with every address of the job, its open ports, service detection and HTTP/TLS fingerprint data. Every worker works towards producing exactly that structure. The backend builds all scan-data features on it. The document also lists what the current `nmap-worker` output still lacks, and what the job must provide (domains per IP, probe paths).

## Scan jobs in the database

The work a lease hands out already exists: `POST /targets/import` with `startScan` (see [the backend README](../backend/README.md#targets-and-scan-jobs)) queues a `Scan` and splits its addresses into `ScanJob` rows (`apps/backend/prisma/schema/scans/`). The lease, heartbeat and result handlers read and update those rows.

| `ScanJob` field | Meaning |
|---|---|
| `scanId`, `sequence` | The run it belongs to and its position (1..`Scan.jobCount`, in address order) |
| `kind` | `discovery` (created by the import) or `service`; see the open questions below |
| `status` | `queued` → `leased` → `completed` / `failed`, or `stopped`; an expired lease goes back to `queued` |
| `subnet` | The smallest aligned IPv4 CIDR containing the whole batch, ready for `NmapJob.subnet` |
| `targets` | IPv4 addresses and CIDRs inside `subnet`, at most `Scan.batchSize` addresses in total (256 by default, never above 1024, the `NmapJob` limit) |
| `hosts` | `[{ ip, domain }]` for domains the backend resolved into this batch (one IP may appear under several domains) |
| `attempts`, `leaseId`, `leasedBy`, `leaseExpiresAt`, `heartbeatAt` | Lease bookkeeping; the `(status, leaseExpiresAt)` index serves the lease query |
| `startedAt`, `finishedAt`, `durationMs`, `error` | Timing for adaptive batch sizing, and the last failure |

Scan parameters live on the parent `Scan`, snapshotted from the backend's env when it was queued: `ports` (a TCP port spec such as `22,80,8000-8100`), `maxRate` (packets per second) and `batchSize`.

Open questions for the lease implementation:

- Which worker consumes the `discovery` jobs: Masscan over `targets` with `Scan.ports`, followed by `service` jobs built from its hits, or Nmap directly (every address of `targets` × `Scan.ports`)?
- ~~`NmapJob.targets` rejects duplicate IPs, but `hosts` can list one IP under two domains.~~ Settled by the [result format](../../docs/worker-result-format.md#what-the-job-must-provide): the job lists each IP once with all its domains, and the worker fingerprints HTTP once per domain.

## Scan safety (PDF requirement)

Scans must be **safe**: detection only, no exploitation and no login attempts. The rate must be limited (`--max-rate`, `--scan-delay`, timing), a scan may only cover the ports and ranges allowed by the configuration, and it is stopped once the time window is exceeded.
