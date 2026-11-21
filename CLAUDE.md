# CLAUDE.md

This file guides Claude Code when working in this repository. It is deliberately short: the details of each app live in its `README.md`, and **those are the source of truth**.

## What this repository is

An **Attack Surface Intelligence** prototype for the HackNation 2026 hackathon. The task was set by the AGH Information Security Center (Centrum Bezpieczeństwa Informacji AGH). The system periodically scans large networks (>10,000 IPs), detects live hosts and services, fingerprints HTTP/HTTPS (title, status code, headers, cookies, TLS, redirects), recognizes technologies and CMSs, supports custom detection signatures and shows changes between scans. On top of that come RBAC, encryption of data at rest, CSV/JSON import/export and DefectDojo integration.

## Task context: always include the PDF

**Before any non-trivial work, add `hackathon-zadanie.pdf` (repo root) to the context and read it.** It is written in Polish and is the only source of truth for requirements, evaluation criteria and constraints. Without it, it is easy to build something that works but does not meet the task. When anything in the repo contradicts the PDF, the PDF wins.

Most frequently needed parts (numbering as in the PDF):

- **Section 2, items 1–16**: functional requirements, including importing IPs/CIDRs/domains (form, CSV, JSON), scan diffs, custom signatures, RBAC with **four roles** (item 13), edits preserved across scans (item 14), encryption at rest (item 16).
- **Signature module**: **safe detection only**, no exploitation and no login attempts.
- **Scanning**: multithreaded (nmap), duration measurement, adaptive splitting into subgroups, time windows and frequency, stopping and resuming in the next window, rate limiting.
- **Section 3**: minimum and "nice to have" scope. **Section 6**: how it will be tested (at least two scan runs, roles, import, editing). **Section 8**: evaluation criteria weights.

## Before you start

- Changing code, env variables or an app's commands → read its `README.md` first.
- Per-app commands are in the READMEs. Only root commands are listed below.

## Language

English is the project's default language: documentation, code comments, commit messages, PR descriptions and the frontend's default (reference) locale. Polish appears only in the Polish UI translations (`locales/pl`) and in the task PDF.

## Docs and translations in the same change

- Changing an app's stack, commands, env variables or structure → update its `README.md`.
- Changing conventions, monorepo commands or repo structure → update this file.
- When you create a **new** `README.md` or a file in `docs/`, ask the user whether to add it to the "Where to look" table.
- Every UI-facing string is added **right away in both English and Polish** (`apps/frontend/src/lib/i18n/locales/{en,pl}`). Do not copy English text into the Polish file. `pnpm test` only checks that the keys match, not the quality of the translation.

## Where to look

| Topic | Source |
|---|---|
| Requirements, evaluation criteria, constraints | `hackathon-zadanie.pdf` (repo root, in Polish) |
| Frontend (stack, bulletproof-react structure, data fetching, i18n) | [`apps/frontend/README.md`](apps/frontend/README.md) |
| Backend (stack, modules, Prisma, env, validation) | [`apps/backend/README.md`](apps/backend/README.md) |
| C++ workers (conventions, HTTP pull protocol, scan safety) | [`apps/workers/README.md`](apps/workers/README.md) |
| nmap-worker (CMake/Docker build, network capabilities) | [`apps/workers/nmap-worker/README.md`](apps/workers/nmap-worker/README.md) |
| Contract (zod schemas, OpenAPI generation, adding an endpoint) | [`packages/contracts/README.md`](packages/contracts/README.md) |
| Typed API client (and why it uses TS 6) | [`packages/api-client/README.md`](packages/api-client/README.md) |
| Local infrastructure (PostgreSQL, worker in compose) | [`docker/README.md`](docker/README.md) |
| Technical documentation and presentation | [`docs/`](docs/) |

## Repository structure

A pnpm + turbo monorepo. The workspaces are `apps/*` and `packages/*`.

- `apps/frontend`: React 19 + Vite 8 + React Router 8 (data mode) + Tailwind 4 + shadcn/ui + TanStack Query.
- `apps/backend`: Express 5 + TS (built with tsdown, dev with tsx). Talks to PostgreSQL through Prisma 7. **The only component that writes to the database.**
- `apps/workers/<name>`: C++23 + CMake + nmap workers, built and run in Docker. **Not pnpm workspaces** (no `package.json`), so `pnpm build` does not need a local C++ compiler.
- `packages/contracts`: `@hacknation/contracts`, zod schemas and types. Generates the committed `openapi.json`. A source-only package with no build step.
- `packages/api-client`: `@hacknation/api-client`, types generated from `openapi.json` + `openapi-fetch`. **The only workspace on TypeScript 6** (`openapi-typescript` needs the JS API that TS 7 no longer ships).
- `docker/`: Docker Compose (PostgreSQL 19, worker under the `workers` profile). Not a workspace.
- `docs/`: technical documentation and the presentation.

## Architecture (settled)

- **Contract:** `contracts/*.schema.ts` (zod) → `pnpm generate` → `openapi.json` → `api-client` (types) → frontend (`api.useQuery("get", "/path")`). The backend validates requests with the same schemas. The C++ workers take their endpoint definitions from the same `openapi.json`.
- **Workers ↔ backend:** HTTP pull. A worker takes a batch of work (lease + heartbeat) and sends results back over REST. Workers have no database access.
- **Auth/RBAC:** local accounts (argon2) and a JWT in an httpOnly cookie. The four roles from the PDF (item 13). Not implemented yet.
- **Sensitive data:** encrypted at rest at the application level. To be designed together with the models.

## Monorepo commands

Root commands only. Per-app commands are in their READMEs.

```bash
pnpm install        # dependencies for the whole monorepo (+ prisma generate)
pnpm project:setup  # copies every .env*.example to .env (never overwrites; --force makes a backup)
pnpm dev            # turbo dev: backend :3001 (+ /docs), frontend :3000
pnpm build          # turbo build
pnpm lint           # type-aware oxlint in every workspace
pnpm check-types    # tsc (TS 7; api-client: TS 6)
pnpm test           # vitest
pnpm generate       # contracts -> openapi.json -> api-client/src/generated (commit the output)
pnpm clean
pnpm db:up          # PostgreSQL in Docker (pnpm db:logs)
pnpm db:reset       # drop + migrations + seed
pnpm infra:up       # all default compose services (infra:down, infra:logs)
pnpm workers:build  # build worker images (workers:up, workers:down, workers:logs)
```

## Conventions

- **After every change in `packages/contracts`, run `pnpm generate`** and commit `openapi.json` and `api-client/src/generated`. CI rejects stale generated files.
- Import aliases: `@/*` → `apps/frontend/src/*`, `~backend/*` → `apps/backend/src/*`.
- Every workspace has its own `tsconfig.json` and `.oxlintrc.json` (the latter extends the root `.oxlintrc.json`). TS 6+ defaults to `types: []`, so list `types` (e.g. `["node"]`, `["vite/client"]`) explicitly.
- **Adding dependencies:** before adding a package, check its latest version on npm (`npm view <pkg> version`). Never write a version from memory. `pnpm-workspace.yaml` sets `minimumReleaseAge: 2880` (48 h). If the latest version is younger than that, use the newest version that is more than 48 h old. Do not disable this safeguard.
- **Scanner safety** (PDF, section 2): detection only, no exploitation and no login attempts. The rate is always limited. Only allowed ports and ranges are scanned. When the time window is exceeded, the scan stops.
- **Comments only for non-obvious things, and short:**
  - Write them only for a constraint that will surprise the next person, a rejected obvious alternative, or something that looks like a bug but is not.
  - One line or a few bullet points, never paragraphs.
  - Do not repeat what the name or type already says. No docblocks on every function.
  - How a module fits together belongs in the app's `README.md`.
