# docker/

Local infrastructure in Docker Compose. You run the backend and frontend with `pnpm dev`; only what they depend on runs here.

| Service | Profile | Description |
|---|---|---|
| `postgres` | default | PostgreSQL 19 (alpine), port bound to `127.0.0.1:5432` only |
| `nmap-worker` | `workers` | C++ worker from `apps/workers/nmap-worker` |
| `masscan-worker` | `workers` | One-shot C++ masscan sweep from `apps/workers/masscan-worker` (`run --rm -T` with a job on stdin) |

## Commands (from the repo root)

```bash
pnpm db:up          # Postgres only
pnpm db:logs
pnpm infra:up       # all services in the default profile
pnpm infra:down
pnpm workers:build  # build the worker image
pnpm workers:up     # build + start the worker (workers profile)
pnpm workers:logs
pnpm workers:down
```

## PostgreSQL

- Image: `postgres:19-alpine`, named volume `hacknation-postgres-data`.
- Default credentials: `hacknation` / `hacknation`, database `hacknation`. They match `apps/backend/.env.example`. Override them with `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` (in your shell or in `docker/.env`).
- The volume is mounted at `/var/lib/postgresql`, not `.../data`. Since Postgres 18 the image keeps its data in a version-numbered subdirectory.
- Wiping the data: `docker compose -f docker/docker-compose.yml down -v`.

## nmap-worker

By default it connects to the backend on the host via `host.docker.internal:3001`. It has `cap_add: [NET_RAW, NET_ADMIN]`. Details are in [`apps/workers/nmap-worker/README.md`](../apps/workers/nmap-worker/README.md).

## masscan-worker

A one-shot CLI rather than a long-running service. Its default command only prints usage, so `pnpm workers:up` does not start a scan. Run a job with `docker compose -f docker/docker-compose.yml --profile workers run --rm -T masscan-worker < job.json`. It has `cap_add: [NET_RAW, NET_ADMIN]`. Details are in [`apps/workers/masscan-worker/README.md`](../apps/workers/masscan-worker/README.md).
