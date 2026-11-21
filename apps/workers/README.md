# apps/workers

Scanning workers written in **C++**. One directory is one worker: `apps/workers/<name>/` with its own `CMakeLists.txt`, `CMakePresets.json`, `Dockerfile` and `README.md`.

This directory is **not a pnpm workspace** (it has no `package.json`), so turbo skips it and `pnpm build` does not need a local C++ compiler. Workers are built and run in Docker (`pnpm workers:build`, `pnpm workers:masscan`, both masscan-worker only for now), and CI compiles every image.

| Worker | Description |
|---|---|
| [`nmap-worker`](nmap-worker/README.md) | Host and service discovery via nmap (skeleton only for now) |
| [`masscan-worker`](masscan-worker/README.md) | High-speed TCP SYN sweep across subnets or all 65,535 ports via masscan. JSON job in, JSON topology of live hosts out |

## Backend protocol: HTTP pull (settled, not implemented yet)

Workers have no database access. Only the backend writes to it (Prisma). Each worker:

1. **Lease**: takes a batch of work from the backend (a subgroup of addresses from a scan target) together with its parameters: ports, rate limits, time window, timeout.
2. **Scan**: runs nmap (`-oX -` → XML parsing) and, optionally, HTTP fingerprinting. It watches the time window and stops working once the window is exceeded.
3. **Result**: sends results and metrics (duration, host count) back over REST, and the backend adaptively sizes the next batches based on those measurements.
4. **Heartbeat** extends the lease. A lease without a heartbeat expires and the batch returns to the pool.

Worker endpoints will be described in `packages/contracts` (tag `Workers`), together with the rest of the API. Worker authentication (a machine token) will be decided together with the auth module.

## Scan safety (PDF requirement)

Scans must be **safe**: detection only, no exploitation and no login attempts. The rate must be limited (`--max-rate`, `--scan-delay`, timing), a scan may only cover the ports and ranges allowed by the configuration, and it is stopped once the time window is exceeded.
