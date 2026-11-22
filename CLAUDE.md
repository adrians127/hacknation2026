# CLAUDE.md

This file guides Claude Code when working in this repository. It is deliberately short: the details of each app live in its `README.md`, and **those are the source of truth**.

## What this repository is

**SubSurf**, an Attack Surface Intelligence prototype for the HackNation 2026 hackathon. The task was set by the AGH Information Security Center (Centrum Bezpieczeństwa Informacji AGH). The system periodically scans large networks (>10,000 IPs), detects live hosts and services, fingerprints HTTP/HTTPS (title, status code, headers, cookies, TLS, redirects), recognizes technologies and CMSs, supports custom detection signatures and shows changes between scans. On top of that come RBAC, encryption of data at rest, CSV/JSON import/export and DefectDojo integration.

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
| Worker result format (locked source of truth for scan data) | [`docs/worker-result-format.md`](docs/worker-result-format.md) |
| Contract (zod schemas, OpenAPI generation, adding an endpoint) | [`packages/contracts/README.md`](packages/contracts/README.md) |
| Typed API client (and why it uses TS 6) | [`packages/api-client/README.md`](packages/api-client/README.md) |
| Local infrastructure (PostgreSQL, DefectDojo; workers: separate compose file) | [`docker/README.md`](docker/README.md) |
| DefectDojo API (push/pull, dedup, status mapping, access, demo data) | [`docs/defectdojo-integration.md`](docs/defectdojo-integration.md) |
| Technical documentation and presentation | [`docs/`](docs/) |

## Repository structure

A pnpm + turbo monorepo. The workspaces are `apps/*` and `packages/*`.

- `apps/frontend`: React 19 + Vite 8 + React Router 8 (data mode) + Tailwind 4 + shadcn/ui + TanStack Query + TanStack Table.
- `apps/backend`: Express 5 + TS (built with tsdown, dev with tsx). Talks to PostgreSQL through Prisma 7. **The only component that writes to the database.**
- `apps/workers/<name>`: C++23 + CMake + nmap workers, built and run in Docker. **Not pnpm workspaces** (no `package.json`), so `pnpm build` does not need a local C++ compiler.
- `packages/contracts`: `@subsurf/contracts`, zod schemas and types. Generates the committed `openapi.json`. A source-only package with no build step.
- `packages/api-client`: `@subsurf/api-client`, types generated from `openapi.json` + `openapi-fetch`. **The only workspace on TypeScript 6** (`openapi-typescript` needs the JS API that TS 7 no longer ships).
- `docker/`: Docker Compose. `docker-compose.yml` is infrastructure (PostgreSQL 19, local DefectDojo), `docker-compose.workers.yml` is the scan workers. Not a workspace.
- `docs/`: technical documentation and the presentation.

## Architecture (settled)

- **Contract:** `contracts/*.schema.ts` (zod) → `pnpm generate` → `openapi.json` → `api-client` (types) → frontend (`api.useQuery("get", "/path")`). The backend validates requests with the same schemas. The C++ workers take their endpoint definitions from the same `openapi.json`.
- **Frontend mocks:** an endpoint the backend doesn't have yet is mocked only in the feature's `api/` hooks (TanStack Query), never in components, so switching to the backend changes one function. See [`apps/frontend/README.md`](apps/frontend/README.md#mocking-endpoints-the-backend-doesnt-have-yet).
- **Workers ↔ backend:** HTTP pull. A worker takes a batch of work (lease + heartbeat) and sends results back over REST. Workers have no database access.
- **Worker result format (locked):** [`docs/worker-result-format.md`](docs/worker-result-format.md) is the source of truth for the `{ scan, hosts[] }` JSON a worker returns for one job.
  - Workers work towards producing exactly that structure.
  - The backend builds every scan-data feature on it: storing observations, diffs, dashboard, signatures/detections, export/import, DefectDojo.
  - **Read it before designing any such feature.** Change the document first (with the user's agreement), then the code. The contract (`WorkerResultSchema`) matches it; the `nmap-worker` output does not yet (the document lists the gap).
- **Worker results → database:** `resultsService.ingest()` writes observations per scan (`ScanJobResult`, `HostObservation`, `HostnameObservation`, `PortObservation` with protocol details as JSONB in `details`) and the `Host`/`Service` assets that live across scans and hold user edits. Details: [`apps/backend/README.md`](apps/backend/README.md#scan-results).
- **Scan results → users:** hosts are browsed per scan (`GET /scans/{id}/hosts`), with new/gone/changed/unknown computed against the base scan (the previous scan with results, or any older scan passed as `?base=`) by `modules/scans/scan-diff.ts`, only where both scans got an answer. The host detail adds field-level changes, and every host carries its lifecycle (active, unstable, missing, inactive). The frontend compares two scans side by side at `/app/scans/compare`. Edits (`PATCH /hosts/...`: note, tags, triage, service corrections) go to the `Host`/`Service` assets, so they show in every scan and survive later ones. `POST /scans/{id}/hosts/tags` adds or removes one tag on the scan's hosts by IP/CIDR. Details: [`apps/backend/README.md`](apps/backend/README.md#browsing-scan-results).
- **Demo data:** `pnpm db:seed:hosts` seeds realistic results in the locked format (`apps/backend/src/demo/`). Build and try scan-data features on it. Details: [`apps/backend/README.md`](apps/backend/README.md#demo-data).
- **Targets → scan jobs:** the import (`POST /targets/import`; manual, CSV and JSON all go through the shared parser in `contracts/src/targets/target-input.ts`) fills the `Target` inventory and can queue a `Scan` split into `ScanJob` batches. Workers lease those rows; the lease endpoints are not implemented yet. Details: [`apps/backend/README.md`](apps/backend/README.md#targets-and-scan-jobs).
- **Auth/RBAC (implemented):**
  - local accounts (argon2id) and a 15-minute access JWT plus a rotating refresh token, both in httpOnly cookies;
  - roles are database rows built from the `resource:action` catalog in `contracts/src/auth/permissions.ts`;
  - the PDF's four roles (item 13) are locked system roles, and admins create custom roles (item 12);
  - details and the rules for mapping new permissions onto system roles: [`apps/backend/README.md`](apps/backend/README.md#auth-and-rbac).
- **Sensitive data:** encrypted at rest at the application level (AES-256-GCM, `DATA_ENCRYPTION_KEY`, `apps/backend/src/lib/crypto.ts`). Scan results store sensitive JSON fields as `{ "$enc": "v1.…" }`, and host/service notes are encrypted too; the other tables are still to be covered (see the backend README).
- **Vulnerabilities:** `modules/vulnerabilities` mirrors NVD and OSV.dev into PostgreSQL and matches services (nmap CPE + distribution package revision of the newest observation) against them. Sources and matchers are plug-ins (`sources/registry.ts`, `matchers/registry.ts`); syncs (incremental every 8 h, full weekly) and all matching run in the separate `vuln-sync` process (`pnpm vulns:sync`), never in the API, which only queues requests. Matches are retracted with a reason, never deleted; triage is kept per service and CVE. Details: [`apps/backend/README.md`](apps/backend/README.md#vulnerabilities).
- **DefectDojo:** a local instance runs in `docker/` (`http://localhost:8080`, fixed dev API token). The backend will push findings through `/api/v2/import-scan/`. Not implemented yet.

## Monorepo commands

Root commands only. Per-app commands are in their READMEs.

```bash
pnpm install        # dependencies for the whole monorepo (+ prisma generate)
pnpm project:setup  # .env*.example -> .env; on an existing .env adds only missing keys (--force: replace + backup)
pnpm dev            # turbo dev: backend :3001 (+ /docs), frontend :3000
pnpm build          # turbo build
pnpm lint           # type-aware oxlint in every workspace
pnpm check-types    # tsc (TS 7; api-client: TS 6)
pnpm test           # vitest (backend tests need `pnpm db:up`: they use a separate hacknation_test database)
pnpm generate       # contracts -> openapi.json -> api-client/src/generated (commit the output)
pnpm clean
pnpm db:up          # PostgreSQL in Docker (pnpm db:logs)
pnpm db:reset       # drop + migrations + seed (system roles, admin, demo accounts)
pnpm db:seed:hosts  # demo scan data: four scans of a /18 through the real ingest (--json <dir> also writes the results)
pnpm vulns:sync     # vulnerability sync process (NVD, OSV); --once [--source id] [--full] [--rematch] for one pass
pnpm vulns:mirror <dir>   # download the vulnerability sources for an offline lab (vulns:import imports a file)
pnpm infra:up       # all infrastructure compose services, DefectDojo included (infra:down, infra:logs)
pnpm dojo:up        # DefectDojo only, :8080 (dojo:logs, dojo:smoke)
pnpm workers:build  # build the masscan-worker image (run a sweep: pnpm workers:masscan < job.json)
pnpm workers:manager  # build + run worker-manager on its example job list; results in worker-results/
```

## Conventions

- **After every change in `packages/contracts`, run `pnpm generate`** and commit `openapi.json` and `api-client/src/generated`. Nothing checks this automatically, so a forgotten `pnpm generate` silently desyncs frontend, backend and workers.
- Import aliases: `@/*` → `apps/frontend/src/*`, `~backend/*` → `apps/backend/src/*`.
- Every workspace has its own `tsconfig.json` and `.oxlintrc.json` (the latter extends the root `.oxlintrc.json`). TS 6+ defaults to `types: []`, so list `types` (e.g. `["node"]`, `["vite/client"]`) explicitly.
- **Adding dependencies:** before adding a package, check its latest version on npm (`npm view <pkg> version`). Never write a version from memory. `pnpm-workspace.yaml` sets `minimumReleaseAge: 2880` (48 h). If the latest version is younger than that, use the newest version that is more than 48 h old. Do not disable this safeguard.
- **Every protected endpoint:** `requireAuth` + `requirePermission("<resource>:<action>")` in its routes file, `security: cookieAuth` in its contract registration, and the permission named in the description. A new permission goes into the catalog and `SYSTEM_ROLE_PERMISSIONS` (see the backend README). The frontend hides or blocks the matching UI with `useCan` / `GuardedButton`, which is a hint only.
- **Scanner safety** (PDF, section 2): detection only, no exploitation and no login attempts. The rate is always limited. Only allowed ports and ranges are scanned. When the time window is exceeded, the scan stops.
- **Comments only for non-obvious things, and short:**
  - Write them only for a constraint that will surprise the next person, a rejected obvious alternative, or something that looks like a bug but is not.
  - One line or a few bullet points, never paragraphs.
  - Do not repeat what the name or type already says. No docblocks on every function.
  - How a module fits together belongs in the app's `README.md`.

## C++ workers

Applies to everything under `apps/workers/`. Follow the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines) unless a rule below says otherwise.

### Language standard

- **ISO C++23, no compiler extensions** (`CMAKE_CXX_STANDARD 23`, `CMAKE_CXX_STANDARD_REQUIRED ON`, `CMAKE_CXX_EXTENSIONS OFF`). No GNU-only syntax (VLAs, statement expressions, `__attribute__` where a standard attribute exists).
- Code must build warning-free with `-Wall -Wextra -Wpedantic -Wshadow -Wconversion -Werror`. Fix warnings; never silence them with pragmas or by dropping flags.
- Format with the worker's `.clang-format` (Google base, 4-space indent, 100 columns) before committing.
- Prefer the standard library over hand-rolled code and over third-party libraries when it covers the need.

### Rules

- **Resources:** RAII only. No naked `new`/`delete`, `malloc`/`free`. Use `std::unique_ptr` (with a custom deleter for C handles, as in `nmap-worker/src/main.cpp`), `std::shared_ptr` only for genuinely shared ownership.
- **Types:** `enum class` over plain `enum`; `std::array`/`std::vector` over C arrays; `std::string_view` and `std::span` for non-owning parameters; `std::optional` for "may be absent". No C-style casts, use `static_cast` and friends. `reinterpret_cast`/`const_cast` need a comment saying why.
- **Errors:** recoverable failures (network, nmap exit code, XML/JSON parsing) return `std::expected<T, Error>`. Exceptions are for programming errors and startup failures only; `main` catches everything and exits non-zero. No exception may escape a thread.
- **Correctness helpers:** `const` by default (variables, member functions, references); `constexpr` where possible; `[[nodiscard]]` on functions whose result must not be ignored; `override`/`final` on virtual overrides; `explicit` on single-argument constructors; `noexcept` on moves and destructors.
- **Output:** `std::print`/`std::println`/`std::format`, not `printf` or `iostream`.
- **Time:** `std::chrono` types for every duration, deadline and timeout. No raw `int` seconds in interfaces.
- **Concurrency:** `std::jthread` + `std::stop_token` (stopping on time-window expiry goes through the stop token). Shared state is guarded by a `std::mutex` with `std::scoped_lock`, or is `std::atomic`. No detached threads.
- **Running processes (security):** never build a shell command from scan input (targets, ports, hostnames all come from users/the backend). Spawn nmap with an argument vector (`posix_spawn`/`execvp`), never `system()` or `popen()` with interpolated strings. Validate targets and ports before passing them on.
- **Headers:** `#pragma once`; include what you use; no `using namespace` in headers (and never `using namespace std`). Order includes: own header, project headers, third-party, standard library — each group sorted.
- **Globals:** no mutable globals; configuration is read once (from env) into a struct and passed down. Helpers private to a `.cpp` go in an anonymous namespace.

### Naming conventions

| Entity | Style | Example |
|---|---|---|
| Files | `snake_case`, `.hpp` / `.cpp` | `scan_job.hpp`, `scan_job.cpp` |
| Namespaces | `snake_case`, one per worker | `nmap_worker`, `nmap_worker::http` |
| Classes, structs, type aliases, concepts | `PascalCase` | `ScanJob`, `LeaseClient`, `HostList` |
| Template parameters | `PascalCase` | `T`, `Callback` |
| Functions and methods | `snake_case`, verb-first | `parse_nmap_xml()`, `send_heartbeat()` |
| Local variables, parameters, public struct members | `snake_case` | `host_count`, `max_rate` |
| Private/protected data members | `snake_case_` (trailing underscore) | `lease_id_` |
| Constants (`constexpr`, `const` at namespace scope) | `kPascalCase` | `kDefaultTimeout` |
| Enum types / enumerators | `PascalCase` / `kPascalCase` | `enum class ScanState { kPending, kRunning }` |
| Macros (avoid; only for build-time defines) | `UPPER_SNAKE`, prefixed with the worker | `NMAP_WORKER_VERSION` |
| Worker directory, CMake target, Docker service | `kebab-case`, ending in `-worker` | `http-worker` |

Booleans read as a question (`is_expired`, `has_tls`). No Hungarian notation, no abbreviations beyond common ones (`url`, `ip`, `tls`, `id`).

### Creating a new worker

Copy the layout of `nmap-worker` (the reference skeleton) instead of starting from scratch:

```
apps/workers/<name>-worker/
├── CMakeLists.txt        # cmake_minimum_required 3.28, C++23 settings above, warning flags, <NAME>_WORKER_VERSION define
├── CMakePresets.json     # Ninja, debug + release, binaryDir build/<preset>
├── Dockerfile            # multi-stage, same ubuntu base for build and runtime, runs as non-root `worker`
├── .dockerignore         # build/, cmake-build-*/
├── .clang-format         # copied unchanged from nmap-worker
├── README.md             # purpose, build/run, configuration (env table), dependencies
└── src/
    ├── main.cpp          # reads config, wires components, returns EXIT_SUCCESS/EXIT_FAILURE
    └── *.hpp / *.cpp     # one class or cohesive unit per file pair
```

Then, in the same change:

1. Read and write the shared JSON: [job and result format](apps/workers/README.md#job-and-result-format) (same input fields, `{scan, hosts}` result with `null` for what the worker cannot discover, same error codes and exit codes).
2. Add the worker to the table in [`apps/workers/README.md`](apps/workers/README.md).
3. Add a service to `docker/docker-compose.workers.yml` (grant only the capabilities it needs; a one-shot CLI worker goes in the `cli` profile).
4. Add the worker's README to the "Where to look" table here (ask the user first, per the rule above).
5. Dependencies: system packages in the Dockerfile or CMake `FetchContent` pinned to a release tag or commit hash, never a branch. Check the latest release before pinning; do not write a version from memory.
