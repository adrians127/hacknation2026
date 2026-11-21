# @subsurf/backend

The REST API of SubSurf: it stores targets, configurations and scan results, hands out jobs to workers and serves data to the frontend. Only the backend writes to the database.

## Stack

- **Node 26** + **TypeScript 7** (`tsc` is used for type-checking only)
- **Express 5**: async handlers, rejected promises reach the error handler
- **Prisma 7.10** + `@prisma/adapter-pg`, **PostgreSQL 19** (from `docker/`)
- **zod 4**: request validation with schemas from `@subsurf/contracts`
- **jose** (JWT, HS256) · `node:crypto` argon2id (passwords) · **cookie-parser**
- **pino** / **pino-http**: logging
- **tsdown** (build, rolldown) · **tsx** (dev, watch) · **Vitest** (tests) · **oxlint** (lint, type-aware)

> Prisma 7.10.1 warns on install that it officially supports Node 20/22/24. On Node 26, `generate`, queries and the Docker image all work. Prisma 8 is still in RC, so we stay on 7.x.

## Commands

```bash
pnpm --filter @subsurf/backend dev          # tsx watch, :3001
pnpm --filter @subsurf/backend build        # tsdown -> dist/index.mjs
pnpm --filter @subsurf/backend start        # node dist/index.mjs
pnpm --filter @subsurf/backend test         # vitest, integration tests: needs `pnpm db:up`
pnpm --filter @subsurf/backend db:migrate   # prisma migrate dev (new migration)
pnpm --filter @subsurf/backend db:studio    # Prisma Studio
pnpm --filter @subsurf/backend db:seed      # system roles, admin, demo accounts (idempotent)
pnpm --filter @subsurf/backend db:seed:hosts  # demo scan data: two scans of a /18 (see "Demo data")
pnpm db:reset                                  # from the repo root: drop + all migrations + seed
```

Swagger UI is at `http://localhost:3001/docs` (only when `NODE_ENV=development`) and serves the committed `openapi.json` from the contract.

## `src/` structure

```
app.ts                 buildApp(): middleware -> /v1 -> notFound -> errorHandler
index.ts               listen, DB connection check, graceful shutdown
config/                env.ts (zod + process.loadEnvFile), database-url.ts (DB_* -> URL)
lib/                   prisma, logger, http-error, api-docs, password, tokens, auth-cookies, auth-context, chunks,
                       crypto (field encryption at rest)
middleware/            validate, authenticate (requireAuth/requireSession), authorize (requirePermission),
                       trusted-origin (CSRF), error-handler, not-found
routes/index.ts        apiRouter: one apiRouter.use("/x", ...) line per module
modules/<feature>/     <feature>.routes.ts | .controller.ts | .service.ts | .test.ts
modules/auth|users|roles   sign-in and sessions, user accounts, roles (+ system-roles sync, first-admin bootstrap)
modules/targets        target inventory: POST /targets/import (manual, CSV and JSON all arrive as one JSON body)
modules/scans          GET /scans… (scan results, hosts per scan, changes: scan-results.*, scan-diff.ts);
                       queues a Scan and its ScanJob batches (scans.service.ts, dns.ts, batching.ts)
modules/results        no routes yet: ingests worker results into observations (details.ts, fingerprint.ts, job-scope.ts)
modules/hosts          PATCH /hosts…: edits of the Host and Service assets; ingest's helpers for those assets
demo/                  deterministic demo scan data for `db:seed:hosts` (not part of the API build)
test/                  integration test setup: test database, TestClient (fetch + cookie jar), sign-in helpers,
                       ingestScan() (scans.ts)
types/express.d.ts     req.auth
generated/prisma       Prisma Client (gitignored, generated in postinstall)
```

**New module:** schemas in `packages/contracts/src/<feature>/` (+ `pnpm generate`), then `src/modules/<feature>/` and one line in `routes/index.ts`. A route declares its contract with `validate({ params, query, body })`, and when a request does not match, the `ZodError` is turned into a 400 automatically. Protected routes start with `requireAuth` and `requirePermission(...)` (see [Auth and RBAC](#auth-and-rbac)).

Request bodies: `app.ts` parses JSON with a 1 MB limit, except for the paths in `OWN_BODY_PARSER_PATHS`, which parse their own larger body in the route, after `requireAuth`/`requirePermission` (`POST /targets/import`: 10 MB, up to 100k entries).

Controllers are objects of arrow functions (oxlint's `unbound-method` rejects methods passed to the router). Errors carry an optional machine-readable `code` (`HttpError.forbidden(message, "LAST_ADMIN")`), sent as `error.code` and translated by the frontend; the codes are listed in `contracts/src/common/common.schema.ts`.

## Auth and RBAC

Local accounts only (no external identity provider). The PDF's four roles (section 2, item 13) are seeded as locked system roles; administrators create custom roles from the same permission catalog (item 12).

### Sessions

- **Passwords:** argon2id through `node:crypto` (`crypto.argon2`, Node ≥ 24.7, so no native addon), stored as PHC strings (`lib/password.ts`). 12–128 characters, no composition rules (NIST 800-63B).
- **Sign-in** (`POST /v1/auth/login`) sets two httpOnly cookies:
  - `subsurf_access`: a 15-minute JWT (HS256, `JWT_SECRET`) carrying only `sub` (user) and `sid` (session). Path `/`, SameSite=Lax.
  - `subsurf_refresh`: `<sessionId>.<secret>`, 7 days, sliding. Path `/v1/auth`, SameSite=Strict. The `Session` row keeps only sha256 of the secret.
- **Refresh** rotates the refresh token. Presenting an older one revokes the whole session (token theft), except within 30 s of the rotation, when it is a parallel request from another tab and only the access token is renewed.
- **Every request** loads the session, user and role in one query (`middleware/authenticate.ts`), so a role change, deactivation or sign-out applies immediately rather than when the JWT expires.
- **Lockout:** 5 failed sign-ins in a row lock the account for 15 minutes. Every failure (unknown email, wrong password, locked or inactive account) gets the same 401, and unknown emails still burn an argon2 verification, so neither the answer nor its timing reveals whether an account exists. There is no per-IP rate limit.
- **Temporary passwords:** new users and password resets get a server-generated password, returned once. Until it is changed, `requireAuth` answers 403 `PASSWORD_CHANGE_REQUIRED`; only `requireSession` routes (`/auth/me`, `/auth/change-password`, `/auth/logout`) work. Changing the password signs out the user's other sessions.
- **CSRF:** SameSite cookies plus `middleware/trusted-origin.ts`: a state-changing request whose `Origin` is neither `CORS_ORIGIN` nor the API itself (Swagger UI) gets 403 `UNTRUSTED_ORIGIN`.
- **Swagger UI:** call `POST /auth/login` from `/docs` first; the cookie then authorizes the other calls.

### Permissions and roles

- The catalog is `PERMISSIONS` in `packages/contracts/src/auth/permissions.ts`, as `resource:action`: `users:*`, `roles:*`, `targets:*`, `scans:read|run` and `hosts:update`. `scans:read` guards the scan results (hosts included), `hosts:update` the edits of hosts and services; the frontend gates its mocked screens with the rest. The admin panel's matrix is built from `PERMISSION_RESOURCES` × `PERMISSION_ACTIONS`.
- A route checks permissions with `requirePermission("users:read")` after `requireAuth`. Services that act on other accounts or roles also call `assertHoldsAll` (below).
- **System roles** (`admin`, `editor`, `analyst`, `viewer`) are read-only. `syncSystemRoles()` (`modules/roles/system-roles.ts`) runs at startup and in the seed: it gives them exactly `SYSTEM_ROLE_PERMISSIONS` and drops permissions that no longer exist from custom roles.
- **Custom roles** are rows with a `permissions` array. Deleting a role that users still have needs `reassignToRoleId` (and `users:update`); the users move and the role is deleted in one transaction.
- **Escalation guards:**
  - nobody grants permissions they do not hold: not in a role they create or edit, not by assigning a role to a user;
  - nobody manages an account or role that holds permissions they lack;
  - nobody changes their own role, edits the role they have, resets their own password or deactivates themselves;
  - at least one active user with the `admin` role always remains (409 `LAST_ADMIN`).
- Users are never hard-deleted, only deactivated (sessions revoked).

### Adding a permission (new module)

1. Add the resource to `PERMISSION_RESOURCES` (and an action to `PERMISSION_ACTIONS` if it is new), and the keys to `PERMISSIONS`.
2. Map them onto the system roles in `SYSTEM_ROLE_PERMISSIONS`, following the rules agreed for this project:

   | Permission kind | admin | editor | analyst | viewer |
   |---|---|---|---|---|
   | read (lists, details, dashboard) | ✓ | ✓ | ✓ | ✓ |
   | update existing data (targets, scan configs, results, findings, signatures) | ✓ | ✓ | ✓ | |
   | create and delete, including import | ✓ | ✓ | | |
   | run, stop and schedule scans (`scans:run`) | ✓ | ✓ | | |
   | export to a CSV/JSON file | ✓ | ✓ | ✓ | ✓ |
   | export to DefectDojo | ✓ | ✓ | | |
   | global scanner limits (`settings:manage`: rate, ports, ranges, time windows) | ✓ | | | |
   | users and roles | ✓ | | | |

3. Guard the routes with `requirePermission(...)`, add the translations (`auth.json`: `permissions.resources.*`, `permissions.actions.*`) and run `pnpm generate`. The next start syncs the system roles.

### Accounts

- **First admin:** from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, created at startup while the database has no users (so the Docker image works without the seed), and by the seed.
- **Demo accounts** (seed with `SEED_DEMO_USERS=true`, never in production): `editor@`, `analyst@` and `viewer@hacknation.local`, password `DEMO_USER_PASSWORD`. With the admin that is one account per system role, for the jury's role tests (PDF section 6).
- Worker (C++) authentication is not part of this module yet.

### Tests

Backend tests are integration tests against a real PostgreSQL (`pnpm db:up`). `src/test/global-setup.ts` creates and migrates a separate `hacknation_test` database; every test starts from truncated tables with the system roles synced. `rbac-matrix.test.ts` checks every system role against every users/roles endpoint.

## Prisma

- `prisma.config.ts`: schema path, migrations, seed and the URL built from `DB_*`. A placeholder URL lets `prisma generate` run on a fresh clone without a database.
- `prisma/schema/schema.prisma`: only the generator and the datasource. Models live in `prisma/schema/<module>/<model>.prisma` (one file per model, in a folder named after the module in `src/modules/` that owns the table).
- Every relation field needs an `@@index`, because Prisma does not create indexes on foreign keys in Postgres.
- Fields holding sensitive data must be encrypted at rest (requirement 16 in the PDF). `src/lib/crypto.ts` does it at the field level: AES-256-GCM with `DATA_ENCRYPTION_KEY`, a value becomes `{ "$enc": "v1.<base64(iv | tag | ciphertext)>" }`, and `decryptJson` returns `unknown`, so readers validate with zod. Scan results use it (see [Scan results](#scan-results)). The auth tables hold only hashes (passwords, refresh secrets), emails and display names. `Host.note` and `Service.note` (free text from analysts) are encrypted with `encryptText`. Still to cover: `Target.value` and `note`, `ScanJob.targets` and `hosts` (`Target.value` is the dedup key, so it will need a blind index such as an HMAC).

## Targets and scan jobs

`POST /targets/import` takes entries from the import form (manual, CSV or JSON, parsed in the browser by the shared parser in `@subsurf/contracts/targets/target-input`) and runs the same parser again: `validate()` rejects what it rejects, the service normalizes and deduplicates.

1. New values go into `Target` (`createMany` with `skipDuplicates`); values already in the inventory are counted as `skipped` and left unchanged.
2. With `startScan` (also requires `scans:run`): domains are resolved to A records **before** the transaction (`modules/scans/dns.ts`: 50 lookups at a time, 2 s timeout, 2 tries). Failures and reserved addresses become `warnings`; the import still succeeds.
3. In one transaction: a `Scan` with `SCAN_DEFAULT_PORTS`, `SCAN_DEFAULT_MAX_RATE` and `SCAN_BATCH_SIZE` snapshotted, a `ScanTarget` row per entry and the `ScanJob` batches from `planScanJobs` (`modules/scans/batching.ts`): addresses merged, split in address order into batches of at most `SCAN_BATCH_SIZE`, never across two /16 blocks. Each job has a `subnet` (the smallest aligned CIDR around it), its `targets` (CIDRs/IPs) and `hosts` (resolved domain → IP pairs).

Jobs start as `queued` with `kind = discovery`. Leasing them (`/workers/*`, machine token) is the workers team's part; see [`apps/workers/README.md`](../workers/README.md#scan-jobs-in-the-database).

## Scan results

The result a worker sends for a job is fixed in [`docs/worker-result-format.md`](../../docs/worker-result-format.md) (locked). It is the backend's single input for scan data. Results storage, diffs between scans, the dashboard, signatures, export/import and DefectDojo all build on it. That document also lists what the backend derives itself: target membership, detections, coverage, new/gone/changed and host lifecycle.

`resultsService.ingest(result)` (`modules/results/`) takes a result already validated with `WorkerResultSchema` and writes it in one transaction. No route calls it yet: `POST /workers/nmap/results` comes with the lease endpoints and the worker token.

**Two layers of tables:**

| Layer | Model | One row per | Notes |
|---|---|---|---|
| Observations (`prisma/schema/results/`), appended, never edited | `ScanJobResult` | lease | The `scan` envelope; `params` keeps `nmapArgs` for the safety audit |
| | `HostObservation` | job result + address | **Every** address of the job, `down` included. Results from separate worker runs remain available for comparison; `ipNumber` (BigInt) supports CIDR range queries |
| | `HostnameObservation` | observation + name + source | `job`, `ptr`, `tls_san` |
| | `PortObservation` | observation + protocol + port | Service detection in columns, `fingerprint` for diffs, everything else in `details` (JSONB) |
| Assets (`prisma/schema/hosts/`), live across scans | `Host` | address ever `up` | `firstSeenAt`/`lastSeenAt`; `note` (encrypted), `tags` and `triage` belong to users and ingest never writes them (PDF item 14) |
| | `Service` | host + protocol + port | Same, plus the user's `*Override` corrections; every `PortObservation` points at its `Service`, so a service's history is one query |

**`PortObservation.details`** holds the rest of the worker's port object: `identity`, `banner`, `scripts` and `http[]`. A new protocol is a new key there, without a migration, once the locked format has it.
- `details.ts` encrypts the fields the format lists as sensitive: `banner`, `scripts`, `http[].headers`, `http[].cookies`, `http[].body.content`, `http[].tls.cert`, `http[].probes`. `openPortDetails()` decrypts and validates them back.
- The rest stays plaintext under a GIN index (`jsonb_path_ops`), for containment queries such as `details @> '{"http":[{"favicon":{"mmh3":…}}]}'`. Queries on encrypted fields (expired certificates, cookie flags) are meant to go through detections computed at ingest.

**Rules ingest applies:**
- **Idempotency:** `ScanJobResult.leaseId` is unique. A result resent under the same lease is a no-op that returns the stored id.
- **Scope:** the job must exist and belong to `scan.scanId` (404 / 400). Every address must be inside the job's `targets`, and every open port inside the scan's `ports` (400 otherwise, nothing is written).
- **Separate runs:** `(resultId, ip)` is unique. A new lease writes its own host and port observations, even when another result in the same scan reported the same address. Same-lease resends remain idempotent.
- **Seen window:** results may arrive out of order, so ingest only ever widens `firstSeenAt`/`lastSeenAt`.
- **Fingerprint** (`fingerprint.ts`): SHA-256 over the service detection and, per HTTP endpoint, status, title, final path, software headers (`server`, `x-powered-by`, …), certificate and favicon hashes. Request-dependent values (dates, cookie values, body hashes, query strings) are left out so unchanged pages do not show up as changed.
- `ScanJob` itself (status, timings) is not touched: its lifecycle belongs to the lease handlers.

## Browsing scan results

Users reach hosts through scans: `/scans` → a scan → the hosts it saw (`modules/scans/scan-results.service.ts`). All of it needs `scans:read`.

| Endpoint | What it returns |
|---|---|
| `GET /scans` | Every scan, newest first: status, timing, hosts by status (`up`, `down`, `timeout`, `cancelled`, `failed`) and open ports |
| `GET /scans/{id}` | The same plus parameters, jobs by status, the base scan and the change counts |
| `GET /scans/{id}/hosts` | The scan's hosts with their services, as this scan saw them, paged in address order. Filters: `q` (IP prefix, hostname, tag, port, service name/product, HTTP title), `triage` (host or any service), `change` |
| `GET /scans/{id}/hosts/{hostId}` | One host in that scan: decrypted HTTP details, banner, NSE scripts, and the address's scan history |

**Changes** (`scan-diff.ts`, PDF items 8–9) compare a scan with its **base scan**, the previous scan (by `createdAt`) that has results. They follow the rules in [`docs/worker-result-format.md`](../../docs/worker-result-format.md#what-the-backend-derives):
- Hosts are keyed by IP and services by IP + protocol + port. A service is `changed` when its `fingerprint` differs.
- A host is `new` (up now, not before), `gone` (up before, `down` now), `changed` (a service is new, gone or changed), `unchanged`, or `unknown` (up before, `timeout`/`cancelled`/`failed` now). Unknown is never gone, and addresses outside this scan's coverage are left out.
- The first scan has no base scan: every `change` is `null`.
- The diff reads only IPs, statuses and fingerprints, so it runs over a whole scan per request; details are loaded for the requested page only. The list's plaintext HTTP summaries come from `httpSummaries()`, without decrypting anything.

**Edits** (`modules/hosts/`, `hosts:update`): `PATCH /hosts/{id}` (note, tags, triage) and `PATCH /hosts/{id}/services/{serviceId}` (the same plus `nameOverride`/`productOverride`/`versionOverride`, `null` clears one). They write the `Host`/`Service` assets, which ingest never touches, so an edit made from any scan shows in every scan and survives later ones (PDF item 14). Triage is `unreviewed | reviewed | important | false_positive`.

## Demo data

`pnpm db:seed:hosts` (after `pnpm db:reset` or `pnpm db:seed`, which create the admin who owns the scans) fills the database with realistic scan results to build features on (`src/demo/`, entry `prisma/seed-hosts.ts`):
- **Network:** 10.40.0.0/18 (16,384 addresses, 64 jobs of 256), about 250 live hosts with domains under `campus.example`: CMSs (WordPress, Joomla, Drupal, Moodle, MediaWiki), CI and admin panels (Jenkins, GitLab, Tomcat manager, phpMyAdmin, Grafana, Kibana, Zabbix), staging (`x-environment: staging`, Django debug page, Swagger UI), databases, Linux and Windows servers, cameras, printers, UPS, BMCs and NAS boxes. Certificates include self-signed, expired and expiring ones; cookies lack `Secure`/`HttpOnly` here and there.
- **Two nightly runs** (2026-11-20 and 2026-11-21, 01:00 UTC) through the real `resultsService.ingest()`. The second run has new, gone and unstable hosts, upgraded software, opened and closed ports, a renewed certificate and a maintenance page, and its last job stops at the deadline (`partial`, `stopReason: "deadline"`, 128 addresses `cancelled`), so the scan ends `stopped`.
- **Deterministic and idempotent:** fixed scan ids and lease ids, a seeded PRNG. Re-running skips what is already there; a fresh copy needs `pnpm db:reset` first. It takes about 10 s.
- `pnpm db:seed:hosts --json <dir>` also writes every worker result as `run-N/job-NNN.json`, e.g. for testing an import of scan results.
- The generator's tests (`src/demo/demo.test.ts`) check that every result passes `WorkerResultSchema` and that the second run really differs.

## Environment variables

`.env.example` documents every variable. `pnpm project:setup` copies it to `.env`; when `.env` already exists, it appends only the variables it lacks and leaves existing values alone, so re-run it after pulling a change that adds one. Real environment variables take precedence over `.env`. A missing or invalid variable stops the process at startup with a readable error.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` = pretty logs, Swagger, stack traces in responses |
| `PORT` | `3001` | HTTP port |
| `LOG_LEVEL` | `info` | pino log level |
| `CORS_ORIGIN` | `http://localhost:3000` | allowed origin (with credentials) |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` `DB_SSLMODE` | — | Postgres connection in parts, no `DATABASE_URL` |
| `JWT_SECRET` | — | HS256 key for access tokens, ≥ 32 characters. Production refuses the `.env.example` value |
| `DATA_ENCRYPTION_KEY` | — | AES-256-GCM key for fields encrypted at rest: 32 bytes, base64 (`openssl rand -base64 32`). Production refuses the `.env.example` value. Changing it makes stored encrypted fields unreadable |
| `ADMIN_EMAIL` `ADMIN_PASSWORD` | — | First admin (startup while there are no users, and the seed). Production refuses the example password |
| `SEED_DEMO_USERS` `DEMO_USER_PASSWORD` | `false` | Seed only: demo accounts for the editor, analyst and viewer roles |
| `SCAN_DEFAULT_PORTS` | 28 common TCP ports | Ports snapshotted onto every queued scan (`22,80,8000-8100` syntax) |
| `SCAN_DEFAULT_MAX_RATE` | `100` | Packets per second a worker may send for one job |
| `SCAN_BATCH_SIZE` | `256` | Addresses per scan job, a power of two from 16 to 1024 |

## Docker

```bash
docker build -f apps/backend/Dockerfile .      # from the repo root
```

A multi-stage build on `node:26.13.1-slim` using `pnpm deploy`; the process runs as `USER node`. The same image runs migrations: `node_modules/.bin/prisma migrate deploy`.
