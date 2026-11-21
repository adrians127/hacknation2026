# docker/

Docker Compose files. You run the backend and frontend with `pnpm dev`; only what they depend on runs here. There are two separate compose projects, so scan hosts can run workers without the database and `down` on one never touches the other.

| File | Project | Services |
|---|---|---|
| `docker-compose.yml` | `hacknation` | Infrastructure: `postgres` |
| `docker-compose.workers.yml` | `hacknation-workers` | Scan workers: `nmap-worker`, `masscan-worker` |

| Service | File | Description |
|---|---|---|
| `postgres` | `docker-compose.yml` | PostgreSQL 19 (alpine), port bound to `127.0.0.1:5432` only |
| `masscan-worker` | `docker-compose.workers.yml` | One-shot C++ masscan sweep from `apps/workers/masscan-worker`, a job on stdin |
| `nmap-worker` | `docker-compose.workers.yml` (profile `nmap`) | Long-running C++ worker from `apps/workers/nmap-worker`. Not needed for now, so it is opt-in and has no pnpm script |

## Commands (from the repo root)

```bash
# infrastructure (docker-compose.yml)
pnpm db:up          # Postgres only
pnpm db:logs
pnpm infra:up       # all infrastructure services
pnpm infra:down

# workers (docker-compose.workers.yml): masscan-worker only
pnpm workers:build                # build the masscan-worker image
pnpm workers:masscan < job.json   # one masscan sweep, result JSON on stdout
```

nmap-worker is not needed for now, so it has no pnpm script. Start it explicitly when you need it:

```bash
docker compose -f docker/docker-compose.workers.yml --profile nmap up -d --build
docker compose -f docker/docker-compose.workers.yml --profile nmap down
```

## PostgreSQL

- Image: `postgres:19-alpine`, named volume `hacknation-postgres-data`.
- Default credentials: `hacknation` / `hacknation`, database `hacknation`. They match `apps/backend/.env.example`. Override them with `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` (in your shell or in `docker/.env`).
- The volume is mounted at `/var/lib/postgresql`, not `.../data`. Since Postgres 18 the image keeps its data in a version-numbered subdirectory.
- Wiping the data: `docker compose -f docker/docker-compose.yml down -v`.

## nmap-worker

Opt-in (profile `nmap`, see the commands above). By default it connects to the backend on the host via `host.docker.internal:3001`. It has `cap_add: [NET_RAW, NET_ADMIN]`. Details are in [`apps/workers/nmap-worker/README.md`](../apps/workers/nmap-worker/README.md).

## masscan-worker

A one-shot CLI rather than a long-running service. Build it with `pnpm workers:build` and run a job with `pnpm workers:masscan < job.json` (that is `docker compose -f docker/docker-compose.workers.yml run --rm -T masscan-worker`). The result JSON goes to stdout and the progress logs to stderr. Set `MASSCAN_WORKER_LOG_LEVEL=debug` or `MASSCAN_WORKER_LOG_FORMAT=json` in your shell to change them; compose passes every `MASSCAN_WORKER_*` variable through. It has `cap_add: [NET_RAW, NET_ADMIN]`. Details are in [`apps/workers/masscan-worker/README.md`](../apps/workers/masscan-worker/README.md).
