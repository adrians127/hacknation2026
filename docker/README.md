# docker/

Docker Compose files. You run the backend and frontend with `pnpm dev`; only what they depend on runs here. There are two separate compose projects, so scan hosts can run workers without the database and `down` on one never touches the other.

| File | Project | Services |
|---|---|---|
| `docker-compose.yml` | `hacknation` | Infrastructure: `postgres`, `defectdojo-*` |
| `docker-compose.workers.yml` | `hacknation-workers` | Scan workers: `nmap-worker`, `masscan-worker`, `worker-manager` |

| Service | File | Description |
|---|---|---|
| `postgres` | `docker-compose.yml` | PostgreSQL 19 (alpine), port bound to `127.0.0.1:5432` only |
| `defectdojo-*` | `docker-compose.yml` | DefectDojo 3.5 (7 containers), UI and API on `127.0.0.1:8080` only. See [DefectDojo](#defectdojo) |
| `masscan-worker` | `docker-compose.workers.yml` | One-shot C++ masscan sweep from `apps/workers/masscan-worker`, a job on stdin |
| `worker-manager` | `docker-compose.workers.yml` (profile `cli`) | One-shot C++ orchestrator from `apps/workers/worker-manager`: job list in, masscan-worker and nmap-worker tasks, results in `worker-results/` |
| `nmap-worker` | `docker-compose.workers.yml` (profile `nmap`) | Long-running C++ worker from `apps/workers/nmap-worker`. Opt-in, no pnpm script |

## Commands (from the repo root)

```bash
# infrastructure (docker-compose.yml)
pnpm db:up          # Postgres only
pnpm db:logs
pnpm infra:up       # all infrastructure services (Postgres + DefectDojo)
pnpm infra:down
pnpm dojo:up        # DefectDojo only
pnpm dojo:logs      # follow the DefectDojo containers (initializer included)
pnpm dojo:smoke     # check the API token and import sample findings

# workers (docker-compose.workers.yml)
pnpm workers:build                # build the masscan-worker image
pnpm workers:masscan < job.json   # one masscan sweep, result JSON on stdout
pnpm workers:manager              # build + run worker-manager on its example.json -> worker-results/
pnpm workers:nmap:build           # build nmap-worker and run its tests
pnpm workers:nmap < apps/workers/nmap-worker/examples/job-local.json > result.json
```

nmap-worker's long-running HTTP pull mode is opt-in. Start it explicitly when you need it:

```bash
docker compose -f docker/docker-compose.workers.yml --profile nmap up -d --build
docker compose -f docker/docker-compose.workers.yml --profile nmap down
```

## PostgreSQL

- Image: `postgres:19-alpine`, named volume `hacknation-postgres-data`.
- Default credentials: `hacknation` / `hacknation`, database `hacknation`. They match `apps/backend/.env.example`. Override them with `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` (in your shell or in `docker/.env`).
- The volume is mounted at `/var/lib/postgresql`, not `.../data`. Since Postgres 18 the image keeps its data in a version-numbered subdirectory.
- Wiping the data: `docker compose -f docker/docker-compose.yml down -v`. This also wipes DefectDojo's volumes.

## nmap-worker

Use `pnpm workers:nmap:build` and `pnpm workers:nmap < job.json` for one-shot jobs, as with masscan. The opt-in HTTP pull mode connects to the backend on the host via `host.docker.internal:3001`; set `WORKER_TOKEN` before starting it. The backend worker endpoints are not implemented yet. Compose selects SYN scanning, grants `cap_add: [NET_RAW, NET_ADMIN]`, and sets `NMAP_PRIVILEGED=1` so Nmap recognizes the granted capabilities. Details are in [`apps/workers/nmap-worker/README.md`](../apps/workers/nmap-worker/README.md).

## masscan-worker

A one-shot CLI rather than a long-running service. Build it with `pnpm workers:build` and run a job with `pnpm workers:masscan < job.json` (that is `docker compose -f docker/docker-compose.workers.yml run --rm -T masscan-worker`). The result JSON goes to stdout and the progress logs to stderr. Set `MASSCAN_WORKER_LOG_LEVEL=debug` or `MASSCAN_WORKER_LOG_FORMAT=json` in your shell to change them; compose passes every `MASSCAN_WORKER_*` variable through. It has `cap_add: [NET_RAW, NET_ADMIN]` and `network_mode: host` (Linux hosts only), so it scans from the host's own network interface. Details are in [`apps/workers/masscan-worker/README.md`](../apps/workers/masscan-worker/README.md).

## worker-manager

A one-shot CLI like masscan-worker, in the `cli` profile. `pnpm workers:manager` (`docker compose -f docker/docker-compose.workers.yml run --rm --build worker-manager`) builds the image from `apps/workers/` (it contains masscan-worker and nmap-worker too) and runs `apps/workers/worker-manager/examples/example.json`. The examples directory is mounted at `/jobs` and the repo-root `worker-results/` at `/results`, and the container runs as `${WORKER_UID:-1000}:${WORKER_GID:-1000}` so the result files are yours. Network setup and capabilities are the same as masscan-worker. Details are in [`apps/workers/worker-manager/README.md`](../apps/workers/worker-manager/README.md).

## DefectDojo

A local DefectDojo instance for developing and demoing the integration (PDF, section 3: export observations as informational findings). It is the upstream [`docker-compose.yml`](https://github.com/DefectDojo/django-DefectDojo/blob/master/docker-compose.yml), adapted: `defectdojo-` service names, healthchecks, its port on loopback only, and images from `docker.io`. Upstream's default registry, `registry.defectdojo.com`, logs every pull and its operator may contact the organization behind it.

| | |
|---|---|
| UI | `http://localhost:8080` |
| Admin | `admin` / `hacknation` |
| API | `http://localhost:8080/api/v2/` (Swagger: `/api/v2/oa3/swagger-ui/`) |
| API token | `943acbe9baff8da06895e4349f3d06ee293189e8` (header `Authorization: Token <token>`) |

Every default is for local development only. Override them in your shell or in `docker/.env`:

| Variable | Default | Description |
|---|---|---|
| `DD_VERSION` | `3.5.201` | Tag of both `defectdojo-django` and `defectdojo-nginx` (they must match) |
| `DD_PORT` | `8080` | Host port, bound to `127.0.0.1` |
| `DD_ADMIN_USER` `DD_ADMIN_PASSWORD` `DD_ADMIN_MAIL` | `admin` / `hacknation` | Applied only when the admin account is first created |
| `DD_API_TOKEN` | see above | The admin's API token, re-applied on every start. Empty = leave tokens alone |
| `DD_DATABASE_USER` `DD_DATABASE_PASSWORD` `DD_DATABASE_NAME` | `defectdojo` | DefectDojo's own Postgres |
| `DD_SECRET_KEY` `DD_CREDENTIAL_AES_256_KEY` | dev values | Django secret key and the key DefectDojo encrypts stored credentials with |

**How it starts.** `defectdojo-initializer` is a one-shot container. It applies migrations, creates the admin on the first run and then runs [`defectdojo/set-api-token.py`](defectdojo/set-api-token.py), which pins the admin's token to `DD_API_TOKEN`. uwsgi and celery start only after it exits successfully, so `pnpm infra:up` and `pnpm dojo:up` block until then. That takes about 20 s, both on an empty volume (it loads a schema snapshot instead of running every migration) and on later starts. After the command returns, nginx can answer `502` for a few more seconds while uwsgi boots. `pnpm db:up` does not start DefectDojo.

- The first `up` pulls about 2 GB of images.
- At idle the stack uses about 0.9 GB of RAM (uwsgi about 470 MB, each celery container about 180 MB). Stop it with `pnpm infra:down` when you are not using it; the volumes survive.
- DefectDojo uses its own `postgres:18.6-alpine` (the version upstream tests against) and Valkey, with no host port. Our `postgres` is untouched.
- Volumes: `defectdojo-postgres-data`, `defectdojo-valkey-data`, `defectdojo-media`. A clean DefectDojo: `docker compose -f docker/docker-compose.yml down` and then `docker volume rm hacknation_defectdojo-postgres-data hacknation_defectdojo-valkey-data hacknation_defectdojo-media`.
- Bumping `DD_VERSION`: use a release that is more than 48 hours old, the same rule as `minimumReleaseAge` for npm.

### Smoke test

`pnpm dojo:smoke` ([`defectdojo/smoke-test.mjs`](defectdojo/smoke-test.mjs), plain Node, no dependencies) authenticates with the token (`GET /api/v2/user_profile/`) and calls `POST /api/v2/import-scan/` twice with `auto_create_context=true`. That creates the product type *SubSurf*, the product *SubSurf smoke test* and a new engagement per run:

1. `scan_type=Nmap Scan` with [`fixtures/nmap-sample.xml`](defectdojo/fixtures/nmap-sample.xml): one Info finding per open port.
2. `scan_type=Generic Findings Import` with [`fixtures/generic-findings.json`](defectdojo/fixtures/generic-findings.json): one Info finding in the shape the backend will export observations in.

It reads `DD_URL` and `DD_API_TOKEN` from the environment and exits non-zero on any error.

### Backend integration (not implemented yet)

The backend runs on the host, so it will reach DefectDojo at `http://localhost:8080` with the token above. The smoke test shows the intended calls: nmap XML can go straight to `import-scan` as `Nmap Scan`, and fingerprinting and signature observations as `Generic Findings Import` with `severity: "Info"`. Re-sending an updated scan into the same test is `POST /api/v2/reimport-scan/`.

- DefectDojo converts finding titles to Title Case (`/wp-admin/` becomes `/Wp-Admin/`). Keep paths and identifiers in `description`, `endpoints` and `unique_id_from_tool`, not in `title`.
- DefectDojo deduplicates `Generic Findings Import` by a hash code computed from the finding's fields, not by `unique_id_from_tool` (`DEDUPLICATION_ALGORITHM_PER_PARSER` in its settings). A recurring observation is recognized as the same finding only if its text stays stable.
- `POST /api/v2/api-token-auth/` with the admin's username and password returns the same pinned token.
