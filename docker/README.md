# docker/

Docker Compose files. In development you run the backend and frontend with `pnpm dev` and only what they depend on runs here; the `app` profile runs the whole app in Docker too ([Everything in Docker](#everything-in-docker)). There are two separate compose projects, so scan hosts can run workers without the database and `down` on one never touches the other.

| File | Project | Services |
|---|---|---|
| `docker-compose.yml` | `hacknation` | Infrastructure: `postgres`, `defectdojo-*`; profile `app`: `backend-migrate`, `backend`, `frontend`; profile `vulns`: `vuln-sync` |
| `docker-compose.workers.yml` | `hacknation-workers` | Scan workers: `nmap-worker`, `masscan-worker`, `naabu-worker`, `httpx-worker`, `tlsx-worker`, `worker-manager` |

| Service | File | Description |
|---|---|---|
| `postgres` | `docker-compose.yml` | PostgreSQL 19 (alpine), port bound to `127.0.0.1:5432` only |
| `backend-migrate` | `docker-compose.yml` (profile `app`) | One-shot `prisma migrate deploy` from the backend image (`apps/backend/Dockerfile`) |
| `backend` | `docker-compose.yml` (profile `app`) | The API, scheduler and worker endpoints, production mode, `127.0.0.1:3001` |
| `frontend` | `docker-compose.yml` (profile `app`) | nginx with the built UI (`apps/frontend/Dockerfile`) on `APP_BIND:APP_PORT` (`127.0.0.1:3000`), `/v1` proxied to `backend` |
| `vuln-sync` | `docker-compose.yml` (profile `vulns`) | The vulnerability sync process (NVD, OSV); start it with both profiles |
| `defectdojo-*` | `docker-compose.yml` | DefectDojo 3.5 (7 containers), UI and API on `127.0.0.1:8080` only. See [DefectDojo](#defectdojo) |
| `masscan-worker` | `docker-compose.workers.yml` | One-shot C++ masscan sweep from `apps/workers/masscan-worker`, a job on stdin |
| `naabu-worker` | `docker-compose.workers.yml` | One-shot Naabu TCP discovery from `apps/workers/naabu-worker`, a job on stdin |
| `tlsx-worker` | `docker-compose.workers.yml` (profile `tlsx`) | One-shot TLS-only probing from `apps/workers/tlsx-worker`, a job on stdin |
| `worker-manager` | `docker-compose.workers.yml` (profile `cli`) | C++ orchestrator from `apps/workers/worker-manager`: job list in (a file, or long-polled from the backend), discovery and Nmap tasks, results in `worker-results/` |
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
pnpm dojo:seed      # fictional demo data (people, assets, two scan runs, triage); -- --reset to start over

# workers (docker-compose.workers.yml)
pnpm workers:build                # build the masscan-worker image
pnpm workers:masscan < job.json   # one masscan sweep, result JSON on stdout
pnpm workers:naabu:build          # build naabu-worker
pnpm workers:naabu < apps/workers/naabu-worker/examples/job-local.json > result.json
pnpm workers:tlsx:build           # build and test TLSX worker
pnpm workers:tlsx < apps/workers/tlsx-worker/examples/job-local.json > result.json
pnpm workers:manager              # build + run worker-manager on its example.json -> worker-results/
pnpm workers:manager:poll         # worker-manager long-polls the backend for jobs until Ctrl+C
pnpm workers:nmap:build           # build nmap-worker and run its tests
pnpm workers:nmap < apps/workers/nmap-worker/examples/job-local.json > result.json
```

nmap-worker's long-running HTTP pull mode is opt-in. Start it explicitly when you need it:

```bash
docker compose -f docker/docker-compose.workers.yml --profile nmap up -d --build
docker compose -f docker/docker-compose.workers.yml --profile nmap down
```

## Everything in Docker

The `app` profile builds and runs the backend and frontend images next to PostgreSQL and DefectDojo. Only Docker (Compose v2) and `openssl` are needed on the machine. From the repo root:

```bash
cp docker/.env.example docker/.env
sed -i \
  -e "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" \
  -e "s|^DATA_ENCRYPTION_KEY=.*|DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)|" \
  -e "s|^WORKER_TOKEN=.*|WORKER_TOKEN=$(openssl rand -hex 32)|" \
  -e "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=$(openssl rand -hex 8)|" \
  docker/.env                                   # macOS: sed -i '' -e …
grep ADMIN_ docker/.env                         # the admin's sign-in

docker compose -f docker/docker-compose.yml --profile app up -d --build   # pnpm app:up
```

- Open `http://localhost:3000` and sign in as the admin; the backend creates it on its first start. It also syncs the worker catalog; there are no demo accounts (create users under Users) and no demo scan data (`pnpm db:seed:hosts` needs the development setup).
- The first `up` builds the images and DefectDojo takes a minute or two; `docker compose -f docker/docker-compose.yml --profile app ps` shows the state. Without DefectDojo: `… --profile app up -d --build frontend` starts only the frontend and what it depends on.
- Other machines: set `APP_BIND=0.0.0.0` and `PUBLIC_URL=http://<host>:3000` in `docker/.env`, then `up` again. The backend gets `COOKIE_SECURE=false` here because the app is served over plain http; set it to `true` behind HTTPS.
- Scanning: run worker-manager in poll mode on the same Linux host. It reads `WORKER_TOKEN` from `docker/.env` and reaches the backend at `localhost:3001`: `mkdir -p worker-results && WORKER_UID=$(id -u) WORKER_GID=$(id -g) docker compose -f docker/docker-compose.workers.yml run --rm -d --build worker-manager --poll --output-dir /results`.
- Vulnerability databases (optional, ~650 MB of downloads): `docker compose -f docker/docker-compose.yml --profile app --profile vulns up -d`.
- Stop: `docker compose -f docker/docker-compose.yml --profile app --profile vulns down` (`pnpm app:down`); add `-v` to wipe every volume. Logs: `pnpm app:logs`.
- `DATA_ENCRYPTION_KEY` encrypts stored scan data: changing it makes that data unreadable.

## PostgreSQL

- Image: `postgres:19-alpine`, named volume `hacknation-postgres-data`.
- Default credentials: `hacknation` / `hacknation`, database `hacknation`. They match `apps/backend/.env.example`. Override them with `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` (in your shell or in `docker/.env`).
- The volume is mounted at `/var/lib/postgresql`, not `.../data`. Since Postgres 18 the image keeps its data in a version-numbered subdirectory.
- Wiping the data: `docker compose -f docker/docker-compose.yml down -v`. This also wipes DefectDojo's volumes.
- **Encryption at rest:** the backend encrypts what scanned hosts returned and what users wrote before it reaches the database, but the columns SQL filters and sorts on (addresses, ports, service names, target values) are plaintext ([which and why](../apps/backend/README.md#prisma)). Outside a developer's laptop, keep this volume and every database backup on an encrypted disk (LUKS/dm-crypt, or the cloud provider's disk encryption), and connect with `DB_SSLMODE=require`.

## nmap-worker

Use `pnpm workers:nmap:build` and `pnpm workers:nmap < job.json` for one-shot jobs, as with masscan. The opt-in HTTP pull mode connects to the backend on the host via `host.docker.internal:3001`; set `WORKER_TOKEN` before starting it. The backend worker endpoints are not implemented yet. Compose selects SYN scanning, grants `cap_add: [NET_RAW, NET_ADMIN]`, and sets `NMAP_PRIVILEGED=1` so Nmap recognizes the granted capabilities. Details are in [`apps/workers/nmap-worker/README.md`](../apps/workers/nmap-worker/README.md).

## masscan-worker

A one-shot CLI rather than a long-running service. Build it with `pnpm workers:build` and run a job with `pnpm workers:masscan < job.json` (that is `docker compose -f docker/docker-compose.workers.yml run --rm -T masscan-worker`). The result JSON goes to stdout and the progress logs to stderr. Set `MASSCAN_WORKER_LOG_LEVEL=debug` or `MASSCAN_WORKER_LOG_FORMAT=json` in your shell to change them; compose passes every `MASSCAN_WORKER_*` variable through. It has `cap_add: [NET_RAW, NET_ADMIN]` and `network_mode: host` (Linux hosts only), so it scans from the host's own network interface. Details are in [`apps/workers/masscan-worker/README.md`](../apps/workers/masscan-worker/README.md).

## naabu-worker

Use `pnpm workers:naabu:build` and `pnpm workers:naabu < apps/workers/naabu-worker/examples/job-local.json > result.json` for the alternative discovery worker. Local tests run with `python3 -m unittest discover -s apps/workers/naabu-worker/tests -v` and use a fake Naabu binary. The manager example `pnpm workers:manager --input /jobs/naabu-nmap-local.json --output-dir /results` schedules Naabu before Nmap on loopback. See [`apps/workers/naabu-worker/README.md`](../apps/workers/naabu-worker/README.md).

## tlsx-worker

Use `pnpm workers:tlsx:build` and `pnpm workers:tlsx < apps/workers/tlsx-worker/examples/job-local.json > result.json` for TLS collection without HTTP data. The image build runs fake scanner tests and a real handshake against a local TLS server. The manager example `pnpm workers:manager --input /jobs/naabu-nmap-tlsx-local.json --output-dir /results` schedules Naabu → Nmap → TLSX with explicit targets at each stage. See [`apps/workers/tlsx-worker/README.md`](../apps/workers/tlsx-worker/README.md).

## worker-manager

A one-shot CLI like masscan-worker, in the `cli` profile. `pnpm workers:manager` (`docker compose -f docker/docker-compose.workers.yml run --rm --build worker-manager`) builds the image from `apps/workers/` (it contains masscan-worker and nmap-worker too) and runs `apps/workers/worker-manager/examples/example.json`. The examples directory is mounted at `/jobs` and the repo-root `worker-results/` at `/results`, and the container runs as `${WORKER_UID:-1000}:${WORKER_GID:-1000}`; the pnpm script creates `worker-results/` and sets both to your uid/gid, so the result files are yours. Network setup and capabilities are the same as masscan-worker. `pnpm workers:manager:poll` runs the same container with `--poll` instead: it long-polls the backend at `BACKEND_URL` (default `http://localhost:3001/v1`, reachable thanks to host networking) with `WORKER_TOKEN` as its bearer token, runs every job list it gets, uploads each task's result and keeps going until Ctrl+C. Set `WORKER_TOKEN` to the backend's `WORKER_TOKEN`. The backend has the results endpoint but not the lease endpoint yet. Details are in [`apps/workers/worker-manager/README.md`](../apps/workers/worker-manager/README.md).

## DefectDojo

A local DefectDojo instance for developing and demoing the integration (PDF, section 3: export observations as informational findings). It is the upstream [`docker-compose.yml`](https://github.com/DefectDojo/django-DefectDojo/blob/master/docker-compose.yml), adapted: `defectdojo-` service names, healthchecks, its port on loopback only, and images from `docker.io`. Upstream's default registry, `registry.defectdojo.com`, logs every pull and its operator may contact the organization behind it.

| | |
|---|---|
| UI | `http://localhost:8088` |
| Admin | `admin` / `hacknation` |
| API | `http://localhost:8088/api/v2/` (Swagger: `/api/v2/oa3/swagger-ui/`) |
| API token | `943acbe9baff8da06895e4349f3d06ee293189e8` (header `Authorization: Token <token>`) |

Every default is for local development only. Override them in your shell or in `docker/.env`:

| Variable | Default | Description |
|---|---|---|
| `DD_VERSION` | `3.5.201` | Tag of both `defectdojo-django` and `defectdojo-nginx` (they must match) |
| `DD_PORT` | `8088` | Host port, bound to `127.0.0.1` |
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
- Port 8080 taken (`bind: An attempt was made to access a socket in a way forbidden`): set `DD_PORT=8088` in `docker/.env` and `DD_URL=http://localhost:8088` for the scripts below.

### Smoke test

`pnpm dojo:smoke` ([`defectdojo/smoke-test.mjs`](defectdojo/smoke-test.mjs), plain Node, no dependencies) authenticates with the token (`GET /api/v2/user_profile/`) and calls `POST /api/v2/import-scan/` twice with `auto_create_context=true`. That creates the product type *SubSurf*, the product *SubSurf smoke test* and a new engagement per run:

1. `scan_type=Nmap Scan` with [`fixtures/nmap-sample.xml`](defectdojo/fixtures/nmap-sample.xml): one Info finding per open port.
2. `scan_type=Generic Findings Import` with [`fixtures/generic-findings.json`](defectdojo/fixtures/generic-findings.json): one Info finding in the shape the backend will export observations in.

It reads `DD_URL` and `DD_API_TOKEN` from the environment and exits non-zero on any error.

### Demo data

`pnpm dojo:seed` ([`defectdojo/seed-demo.mjs`](defectdojo/seed-demo.mjs), plain Node) fills DefectDojo with a fictional *Demo University*. The findings sit on hosts of SubSurf's own demo scans (`pnpm db:seed:hosts`: 10.40.0.0/18, `campus.example`), with the ports and versions those scans report, so **Sync from DefectDojo** in SubSurf matches every one of them. The CVEs are real and match the versions. Findings go through `import-scan` and `reimport-scan` as `Generic Findings Import`, the path the backend export will use.

| | |
|---|---|
| People | `anna.nowak`, `piotr.kowalski`, `marta.wisniewska`, `tomasz.zielinski`, `ewa.lewandowska`, password `SubSurf-demo-2026!` (`DD_DEMO_PASSWORD`). Each sees only the assets they own |
| Organizations and assets | *Core Infrastructure* → `Campus core and DevOps 10.40.0.0/22`, *Research Networks* → `Databases and labs 10.40.8.0/21`, *Public Web* → `Public websites *.campus.example`. Owners, access (`authorized_users`), tags and the *SubSurf demo SLA* (3/14/60/180 days) |
| Scan runs | Run 1 (2026-11-20) is an import, run 2 (2026-11-21) a reimport, matching the two demo scans: the closed Redis port, the upgraded Jenkins and the site that went down are closed; the new staging Jenkins and the MySQL port opened on a web server are new. Findings are grouped by component |
| Findings | 27: RomPager Misfortune Cookie on a UPS card, OpenSSH regreSSHion, telnet/FTP on network gear, exposed databases, admin panels (Tomcat Manager, phpMyAdmin, iDRAC), Django debug mode, EOL software (PHP 7.4, MySQL 5.7, Joomla 3), TLS, cookies, CMS fingerprints |
| Triage | Verified with reviewers and planned fix dates, under review, false positive, out of scope, risk accepted until 2026-12-31, closed manually, notes |

The script is idempotent: a second run only adds what is missing. `pnpm dojo:seed -- --reset` deletes the three demo organizations (with their findings) and their risk acceptance first; people and the SLA are kept. It reads `DD_URL`, `DD_API_TOKEN` and `DD_DEMO_PASSWORD`.

### Backend integration

The backend runs on the host and reaches DefectDojo at `DEFECTDOJO_URL` (`http://localhost:8088`, or your `DD_PORT`) with `DEFECTDOJO_API_TOKEN` (the token above). **Pulling** is implemented: `POST /v1/defectdojo/sync` (see [`docs/defectdojo-integration.md`](../docs/defectdojo-integration.md#sync-into-subsurf-implemented)). **Pushing** too: `POST /v1/defectdojo/push` creates the product `SubSurf discovery` on the first push ([details](../docs/defectdojo-integration.md#push-from-subsurf-implemented)). The smoke test shows the intended calls: nmap XML can go straight to `import-scan` as `Nmap Scan`, and fingerprinting and signature observations as `Generic Findings Import` with `severity: "Info"`. Re-sending an updated scan into the same test is `POST /api/v2/reimport-scan/`.

- DefectDojo converts finding titles to Title Case (`/wp-admin/` becomes `/Wp-Admin/`). Keep paths and identifiers in `description`, `endpoints` and `unique_id_from_tool`, not in `title`.
- DefectDojo deduplicates `Generic Findings Import` by the legacy hash `title + cwe + line + file_path + description` (+ `service`), not by `unique_id_from_tool` or `endpoints`. Put `host:port` in the description and keep the text stable across runs. Details, the push/pull API and status mapping: [`docs/defectdojo-integration.md`](../docs/defectdojo-integration.md).
- `POST /api/v2/api-token-auth/` with the admin's username and password returns the same pinned token.
