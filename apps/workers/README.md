# apps/workers

Scanning workers written in **C++**. One directory is one worker: `apps/workers/<name>/` with its own `CMakeLists.txt`, `CMakePresets.json`, `Dockerfile` and `README.md`.

This directory is **not a pnpm workspace** (it has no `package.json`), so turbo skips it and `pnpm build` does not need a local C++ compiler. Workers are built and run in Docker (`pnpm workers:build`, `pnpm workers:up`), and CI compiles every image.

| Worker | Description |
|---|---|
| [`nmap-worker`](nmap-worker/README.md) | TCP service and version detection on Masscan hits |

## Backend protocol: HTTP pull

Workers have no database access. Only the backend writes to it (Prisma). Each worker:

1. **Lease**: takes a batch of Masscan hits from the backend, grouped by host, with a subnet scope, rate limits, and a deadline.
2. **Scan**: runs Nmap only on the supplied IPs and TCP ports, parses its temporary XML output, and stops when the deadline expires.
3. **Result**: sends results and metrics (duration, host count) back over REST, and the backend adaptively sizes the next batches based on those measurements.
4. **Heartbeat** extends the lease. A lease without a heartbeat expires and the batch returns to the pool.

The Nmap worker sends `WORKER_TOKEN` as a bearer machine token to JSON endpoints described in `packages/contracts` (tag `Workers`). Machine-token validation is separate from user authentication and still needs to be implemented with the backend lease, heartbeat, and result handlers.

## Scan safety (PDF requirement)

Scans must be **safe**: detection only, no exploitation and no login attempts. The rate must be limited (`--max-rate`, `--scan-delay`, timing), a scan may only cover the ports and ranges allowed by the configuration, and it is stopped once the time window is exceeded.
