# SubSurf

SubSurf is an attack surface intelligence prototype for recurring discovery scans of large networks (more than 10,000 IP addresses). It:

- finds live hosts and open services;
- fingerprints HTTP/HTTPS: technologies, CMSs, headers, cookies and TLS;
- shows what changed between scans;
- adds RBAC, encryption at rest, CSV/JSON import and export, and DefectDojo integration.

It was built for HackNation 2026 on a task set by the AGH Information Security Center ([`hackathon-zadanie.pdf`](hackathon-zadanie.pdf), in Polish).

## Project structure

A pnpm + turbo monorepo:

| Path | What it is | Docs |
|---|---|---|
| `apps/frontend` | Web UI: React 19, Vite, Tailwind + shadcn/ui, EN/PL | [README](apps/frontend/README.md) |
| `apps/backend` | REST API under `/v1`: Express 5, Prisma 7, PostgreSQL | [README](apps/backend/README.md) |
| `apps/workers/*` | Scanning workers (masscan, naabu, nmap, httpx, tlsx) and the `worker-manager` that runs them; C++23, built in Docker | [README](apps/workers/README.md) |
| `packages/contracts` | zod schemas shared by the frontend and backend; `openapi.json` is generated from them | [README](packages/contracts/README.md) |
| `packages/api-client` | Typed API client generated from `openapi.json` | [README](packages/api-client/README.md) |
| `docker/` | Docker Compose: PostgreSQL, DefectDojo, the app, the workers and a test lab | [README](docker/README.md) |

## Running the project

### Everything in Docker: one command, no Node or pnpm needed

You only need Docker (Engine 28+, Compose 2.33+) on Linux. From the repo root:

```bash
docker compose -f docker/docker-compose.full.yml up -d --build
```

This command:

- starts the app with demo data, DefectDojo and a scanning worker-manager;
- starts a test network (`docker/lab`) on `10.50.0.0/24`;
- starts a scan of that test network.

| | |
|---|---|
| App | `http://localhost:3000` |
| API docs (Swagger) | `http://localhost:3001/docs` |
| DefectDojo | `http://localhost:8080` (`admin` / `hacknation`) |

Follow the seeding and the first scan with `docker compose -f docker/docker-compose.full.yml logs -f bootstrap`. Stop everything with `docker compose -f docker/docker-compose.full.yml down`; add `-v` to wipe the data too. Details: [`docker/README.md`](docker/README.md#full-stack-with-the-lab).

### Development with pnpm

Install first:

- **Node 26.13.1**, the version pinned in `.nvmrc`. With [nvm](https://github.com/nvm-sh/nvm): `nvm install && nvm use`.
- **pnpm 12**: `npm i -g pnpm`. Node 25+ no longer ships corepack, and the `packageManager` field in `package.json` enforces the right version.
- **Docker**, for PostgreSQL and the workers.

Then:

```bash
pnpm install          # dependencies + prisma generate
pnpm project:setup    # .env.example -> .env in every app (re-run after a pull)
pnpm db:up            # PostgreSQL in Docker
pnpm db:reset         # migrations + seed: roles, admin and demo accounts
pnpm db:seed:hosts    # optional: demo scan data
pnpm dev              # backend :3001 (Swagger: /docs) + frontend :3000
pnpm workers:manager:poll   # optional, another terminal: a worker-manager that runs the scans
```

Other commands: `pnpm lint`, `pnpm check-types`, `pnpm test` (the backend tests need `pnpm db:up`), `pnpm build`, and `pnpm generate` after a contract change. Docker-related commands are in [`docker/README.md`](docker/README.md).

### Accounts

Both ways of running create the same local accounts (from `apps/backend/.env.example`; change them outside local development):

| Account | Role | Password |
|---|---|---|
| `admin@hacknation.local` | Administrator | `admin-change-me-now` |
| `editor@hacknation.local`, `analyst@hacknation.local`, `viewer@hacknation.local` | Editor, Analyst, Viewer | `demo-password-2026` |
