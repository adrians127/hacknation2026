# Attack Surface Intelligence

A prototype tool for recurring discovery scans of large infrastructure (>10,000 IP addresses): detecting live hosts, services, web technologies, CMSs, headers and cookies, and tracking changes between scans. Built for HackNation 2026 on a task set by the AGH Information Security Center ([`hackathon-zadanie.pdf`](hackathon-zadanie.pdf), in Polish).

## Project structure

| Workspace | Description | Docs |
|---|---|---|
| `apps/frontend` | React 19 + Vite 8 + React Router 8, Tailwind 4 + shadcn/ui, EN/PL | [README](apps/frontend/README.md) |
| `apps/backend` | Express 5 + Prisma 7 (PostgreSQL), REST API under `/v1` | [README](apps/backend/README.md) |
| `apps/workers/*` | C++23 scanning workers (nmap), built in Docker | [README](apps/workers/README.md) |
| `packages/contracts` | zod schemas that `openapi.json` is generated from | [README](packages/contracts/README.md) |
| `packages/api-client` | Typed client (openapi-typescript + openapi-fetch) | [README](packages/api-client/README.md) |
| `docker/` | PostgreSQL 19 and the worker in Docker Compose | [README](docker/README.md) |

## Getting started

### Requirements

- **Node 26.13.1** (version pinned in `.nvmrc`: `nvm install && nvm use`)
- **pnpm 12**: `npm i -g pnpm` (Node 25+ no longer ships corepack; the `packageManager` field in `package.json` enforces the right version)
- **Docker** (Postgres and the workers)

### Install and run

```bash
pnpm install          # dependencies + prisma generate
pnpm project:setup    # .env.example -> .env in every app
pnpm db:up            # PostgreSQL in Docker
pnpm dev              # backend :3001 (Swagger: /docs) + frontend :3000
```

nmap worker: `pnpm workers:up` (builds the image and starts it).

### Other commands

```bash
pnpm lint             # oxlint (type-aware)
pnpm check-types      # TypeScript 7
pnpm test             # Vitest
pnpm build
pnpm generate         # after a contract change: openapi.json + client types
```
