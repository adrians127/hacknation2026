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
pnpm --filter @subsurf/backend db:seed:hosts  # demo scan data: four scans of a /18 (see "Demo data")
pnpm --filter @subsurf/backend db:refingerprint  # recompute stored port fingerprints after comparable.ts changes
pnpm --filter @subsurf/backend db:encrypt      # encrypt values a migration left as plain text (also done at startup)
pnpm db:reset                                  # from the repo root: drop + all migrations + seed
pnpm vulns:sync                                # from the repo root: the vulnerability sync process (see "Vulnerabilities")
pnpm vulns:sync --once [--source nvd|osv] [--full] [--rematch]   # one pass, then exit
pnpm vulns:mirror <dir>                        # download the sources' files for an offline lab
pnpm vulns:import --source <id> <file>         # import a file in the source's own format
```

Swagger UI is at `http://localhost:3001/docs` (only when `NODE_ENV=development`) and serves the committed `openapi.json` from the contract.

## `src/` structure

```
app.ts                 buildApp(): middleware -> /v1 -> notFound -> errorHandler
index.ts               listen, DB connection check, graceful shutdown
vuln-sync.ts           the vulnerability sync process and its CLI (`pnpm vulns:*`), separate from the API
config/                env.ts (zod + process.loadEnvFile), database-url.ts (DB_* -> URL)
lib/                   prisma, logger, http-error, api-docs, password, tokens, auth-cookies, auth-context, chunks,
                       crypto (field encryption at rest), encrypt-legacy (encrypts what a migration left plain)
middleware/            validate, authenticate (requireAuth/requireSession), authorize (requirePermission),
                       worker-token (requireWorkerToken), trusted-origin (CSRF), error-handler, not-found
routes/index.ts        apiRouter: one apiRouter.use("/x", ...) line per module
modules/<feature>/     <feature>.routes.ts | .controller.ts | .service.ts | .test.ts
modules/auth|users|roles   sign-in and sessions, user accounts, roles (+ system-roles sync, first-admin bootstrap)
modules/targets        target inventory: GET /targets, PATCH and DELETE /targets/{id}, and POST /targets/import
                       (manual, CSV and JSON all arrive as one JSON body)
modules/scans          GET /scans… (scan results, hosts per scan, changes: scan-results.*, scan-diff.ts), the scan's
                       jobs and POST /scans/{id}/stop; an import's scan (scans.service.ts, dns.ts, batching.ts);
                       exports a scan and imports a results file (scan-export.ts, scan-import.*)
modules/pipelines      /pipelines…: pipelines of worker steps, their runs (queue-run.ts, pipeline-runs.service.ts),
                       schedule.ts (Temporal) and the in-process scheduler (scheduler.ts); see "Pipelines"
modules/results        ingests worker results into observations (details.ts, fingerprint.ts, job-scope.ts)
modules/workers        /workers: the worker registry (users); /workers/manager…: worker-manager's lease and result
                       upload (manager.*, WORKER_TOKEN)
modules/reports        GET /reports…: read-only reports (summary, findings, technologies, exposure, triage, tags,
                       diff of any two scans, one IP, stability, time of day)
modules/hosts          PATCH /hosts…: edits of the Host and Service assets (bulk tags too, routed under /scans);
                       ingest's helpers for those assets
modules/vulnerabilities  /vulnerabilities…: sources (NVD, OSV) mirrored into the database, matching services
                       against them, triage; see "Vulnerabilities"
modules/defectdojo     GET|POST /defectdojo/sync: pulls DefectDojo tags, owners, triage and remediation dates
                       into hosts and services; POST /defectdojo/push: a scan (or a selection) as Info
                       findings (client, import rules, report builder, sync and push runs)
demo/                  deterministic demo scan data for `db:seed:hosts` (not part of the API build)
test/                  integration test setup: test database, TestClient (fetch + cookie jar), sign-in helpers,
                       ingestScan() (scans.ts)
types/express.d.ts     req.auth
generated/prisma       Prisma Client (gitignored, generated in postinstall)
```

**New module:** schemas in `packages/contracts/src/<feature>/` (+ `pnpm generate`), then `src/modules/<feature>/` and one line in `routes/index.ts`. A route declares its contract with `validate({ params, query, body })`, and when a request does not match, the `ZodError` is turned into a 400 automatically. Protected routes start with `requireAuth` and `requirePermission(...)` (see [Auth and RBAC](#auth-and-rbac)).

Request bodies: `app.ts` parses JSON with a 1 MB limit, except for the paths in `OWN_BODY_PARSER_PATHS`, which parse their own larger body in the route, after authentication (`POST /targets/import`: 10 MB, up to 100k entries; `POST /scans/import`: 64 MB of JSON or CSV; `POST /workers/manager/results`: 64 MB, gzip accepted).

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

- The catalog is `PERMISSIONS` in `packages/contracts/src/auth/permissions.ts`, as `resource:action`: `users:*`, `roles:*`, `targets:*`, `scans:read|create|update|delete|run`, `hosts:update`, `vulnerabilities:*`, `pipelines:*`, `workers:read|update|delete` and `defectdojo:read|import|export`. `scans:run` also covers running a pipeline, stopping a scan and changing a pipeline's schedule; `workers:update|delete` are global scanner limits (admin only). `scans:read` guards the scan results (hosts and their vulnerabilities included, and their export to a file), `scans:create` importing a results file as a scan, `scans:update` a scan's name and note, `scans:delete` deleting a scan, `hosts:update` the edits of hosts and services; `vulnerabilities:read` the databases' state and the mappings, `:update` the triage of a service's vulnerabilities, `:run` syncing and enabling sources, `:create`/`:delete` the mappings; `defectdojo:read` the sync and push history, `:import` pulling from DefectDojo, `:export` pushing to it; `targets:read` the inventory, `:create` the import, `:update` a target's note and tags, `:delete` removing one. The admin panel's matrix is built from `PERMISSION_RESOURCES` × `PERMISSION_ACTIONS`.
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
   | export to DefectDojo (`defectdojo:export`) | ✓ | ✓ | | |
| import from DefectDojo (`defectdojo:import`) | ✓ | ✓ | | |
   | global scanner limits (`settings:manage`: rate, ports, ranges, time windows) | ✓ | | | |
   | users and roles | ✓ | | | |

3. Guard the routes with `requirePermission(...)`, add a row per endpoint to `modules/roles/rbac-matrix.test.ts`, add the translations (`auth.json`: `permissions.resources.*`, `permissions.actions.*`) and run `pnpm generate`. The next start syncs the system roles.

### Accounts

- **First admin:** from `ADMIN_EMAIL` / `ADMIN_PASSWORD`, created at startup while the database has no users (so the Docker image works without the seed), and by the seed.
- **Demo accounts** (seed with `SEED_DEMO_USERS=true`, never in production): `editor@`, `analyst@` and `viewer@hacknation.local`, password `DEMO_USER_PASSWORD`. With the admin that is one account per system role, for the jury's role tests (PDF section 6).
- Worker (C++) authentication is not part of this module yet.

### Tests

Backend tests are integration tests against a real PostgreSQL (`pnpm db:up`). `src/test/global-setup.ts` creates and migrates a separate `hacknation_test` database; every test starts from truncated tables with the system roles synced. `modules/roles/rbac-matrix.test.ts` checks every system role against every protected endpoint: one row per operation with the permissions it requires. It fails when an operation the contract marks `cookieAuth` has no row, so a new endpoint adds its row in the same change.

## Prisma

- `prisma.config.ts`: schema path, migrations, seed and the URL built from `DB_*`. A placeholder URL lets `prisma generate` run on a fresh clone without a database.
- `prisma/schema/schema.prisma`: only the generator and the datasource. Models live in `prisma/schema/<module>/<model>.prisma` (one file per model, in a folder named after the module in `src/modules/` that owns the table).
- Every relation field needs an `@@index`, because Prisma does not create indexes on foreign keys in Postgres.
- Fields holding sensitive data are encrypted at rest (requirement 16 in the PDF), in two layers:
  - **Field level**, in the application (`src/lib/crypto.ts`): AES-256-GCM with `DATA_ENCRYPTION_KEY`. A value becomes `{ "$enc": "v1.<base64(iv | tag | ciphertext)>" }`, and `decryptJson` returns `unknown`, so readers validate with zod. The key never reaches the database, so a dump or SQL access does not reveal these fields.
  - **Storage level**, in the deployment: the PostgreSQL volume and its backups must sit on an encrypted disk (see [`docker/README.md`](../../docker/README.md)). This is what protects the columns that stay plaintext.

  | Encrypted in the application | What it is |
  |---|---|
  | `PortObservation.details`: `banner`, `scripts`, `http[].headers`, `cookies`, `body.content`, `tls.cert`, `probes` | What scanned hosts returned (see [Scan results](#scan-results)) |
  | `Host.note`, `Service.note`, `ServiceVulnerabilityTriage.note`, `Target.note`, `Scan.note` | Free text written by users (`encryptText`) |

  | Plaintext on purpose | Why |
  |---|---|
  | Addresses, hostnames, ports, service name/product/version, HTTP status and page title (`HostObservation`, `HostnameObservation`, `PortObservation` columns and the rest of `details`) | SQL filters, sorts and diffs on them. Fixed by the locked [worker result format](../../docs/worker-result-format.md) |
  | `Target.value`, `Target.rangeStart`/`rangeEnd`, `ScanJob.subnet`/`targets`/`hosts`/`params`, `Pipeline.targetSelector`, `Scan.warnings` | The scan scope. `Target.value` is the inventory's dedup, search and sort key, and a scan writes the same addresses and names to `HostObservation.ip` and `HostnameObservation.name` anyway: a blind index would cost substring search and address order without hiding anything |
  | Tags, triage, `VulnerabilityMatch` | SQL filters; a match only restates the plaintext service columns |
  | The vulnerability databases | Public data |
  | The auth tables | Only hashes (passwords, refresh secrets), emails and display names |

  **Rule for a new column:** it is plaintext only when SQL has to filter, sort, join or diff on it. Anything else a user typed or a scanned host returned goes through `lib/crypto.ts`; a note is a `Json?` column written with `encryptText(text.trim()) ?? Prisma.DbNull` and read with `decryptText`.
- A column that becomes encrypted keeps its rows: the migration moves the text into the JSON column as plain strings, and `encryptLegacyRows()` (`lib/encrypt-legacy.ts`) encrypts whatever is not an envelope yet. It runs when the backend starts, before `db:seed:hosts`, and as `db:encrypt`; it is idempotent and safe from several processes. Readers stay strict: a row that was not encrypted yet fails loudly instead of being read as plaintext.

## Targets and scan jobs

The inventory (`modules/targets/`):

| Endpoint | Permission | What it does |
|---|---|---|
| `GET /targets` | `targets:read` | One page in address order: a block before the addresses and blocks it contains, domains last. Filters: `kind`, `tag`, and `q` (part of the value, a tag, or an IPv4 address, which finds the targets that contain it) |
| `PATCH /targets/{id}` | `targets:update` | The note and the tags. The value cannot change: past scans refer to it |
| `DELETE /targets/{id}` | `targets:delete` | Removes the target. Past scans lose only the link to it (`ScanTarget`); their results and the hosts' notes, tags and triage stay |
| `POST /targets/import` | `targets:create` | Adds targets, below |

- `Target.rangeStart`/`rangeEnd` hold the addresses an `ip` or `cidr` covers as integers (null for a domain). They give the address order and the containment search; the import fills them from the shared parser's range (`target-row.ts`).
- Each target carries `lastScanId`/`lastScanAt`, the newest scan with results that covered it (through `ScanTarget`), and `activeHosts`, its addresses that answered `up` in that scan: a block by its range, a domain by the hostnames the scan observed. They are computed for the page only, in three queries.
- An edit survives a later import of the same value: the import leaves existing targets as they are (PDF item 14).
- The list is raw SQL: the search needs explicit `LIKE` escaping (`lib/like.ts`).

`POST /targets/import` takes entries from the import page (the entry form, text, CSV or JSON, parsed in the browser by the shared parser in `@subsurf/contracts/targets/target-input`) and runs the same parser again: `validate()` rejects what it rejects, the service normalizes and deduplicates. An IP range (`10.0.0.1-10.0.0.200`) arrives as one entry and is stored as the CIDR blocks that cover it, each with the range's note.

1. New values go into `Target` (`createMany` with `skipDuplicates`) with the import's optional `tags`; values already in the inventory are counted as `skipped` and left unchanged (note and tags included).
2. With `startScan` (also requires `scans:run`): domains are resolved to A records **before** the transaction (`modules/scans/dns.ts`: 50 lookups at a time, 2 s timeout, 2 tries). Failures and reserved addresses become `warnings`; the import still succeeds.
3. In one transaction, `queueRun()` (`modules/pipelines/queue-run.ts`, shared with pipeline runs): a `Scan` with the **default steps** snapshotted (masscan over the targets with `SCAN_DEFAULT_PORTS`, `SCAN_DEFAULT_MAX_RATE` and `SCAN_BATCH_SIZE`, then nmap on its hits), a `ScanTarget` row per entry and the first step's `ScanJob` batches from `planScanJobs` (`modules/scans/batching.ts`): addresses merged, split in address order into batches of at most the step's batch size, never across two /16 blocks. Each job has a `subnet` (the smallest aligned CIDR around it), its `targets` (CIDRs/IPs), `hosts` (resolved domain → IP pairs), `stepIndex`, `worker` and `params` (the worker's job, see below).

Jobs start as `queued`; worker-manager leases them (see [Pipelines](#pipelines-scheduling-and-leasing)).

## Pipelines, scheduling and leasing

A **pipeline** (`modules/pipelines/`) is a selection of the target inventory, an ordered chain of **steps** (each a worker from the registry with its job parameters) and an optional **schedule**. Every run is a `Scan`; the steps are snapshotted onto it (`Scan.steps`), so editing a pipeline never changes a run already queued.

**Worker registry** (`modules/workers/`, `Worker` and `WorkerManager` tables):
- A worker's `name` is the one worker-manager runs it under (`WORKER_MANAGER_WORKERS`, `jobs[].worker`). Built-in workers (`masscan`, `nmap`) are defined in `contracts/src/workers/worker-catalog.ts` with their inputs (`targets` = address ranges, `hosts` = an earlier step's hits), split strategies and parameter fields; `syncWorkerCatalog()` writes them at startup and in the seed, like the system roles. Admins own `enabled`, `maxRate` and `defaults` only.
- Every lease request registers its manager (`WorkerManager`: id, version, workers, last seen; online for 2 minutes) and adds the worker names the registry lacks as **disabled** custom workers, for an admin to describe (fields as JSON) and enable. A pipeline step, a run and a lease all refuse disabled workers.

**Steps and jobs:**
- A step has `ports`, `rate` (pps for one job, ≤ the worker's `maxRate`), `batchSize`, `maxDurationSeconds`, a worker-manager `split` and the worker's own `params` (checked with `validateStepParams`). Ports must stay inside `SCAN_ALLOWED_PORTS` (400 `PORTS_NOT_ALLOWED`); `Scan.ports` is the union of the steps' ports, so ingest's port check keeps working.
- Input `targets`: jobs are planned when the run starts. Input `previous` (the worker must take `hosts`): when a job of the step before **completes**, its up hosts and open ports (within this step's ports) become one job per `batchSize` hosts, as nmap host objects `{ip, ports, domains}`. The first step always scans the targets.
- The selector picks targets with any of its `tags` (all without tags) and intersects them with its `ranges`, so nothing outside the inventory is scanned.

**Schedule** (`schedule.ts`, `Temporal.ZonedDateTime`): runs at `startsAt` (wall-clock time in `timezone`) and every `every` `hour|day|week` after it, only on `daysOfWeek`; days and weeks keep the wall-clock time across DST. `windowMinutes` is the time window of each run (PDF: time windows, stop and resume in the next one):
- The scheduler (`scheduler.ts`, every `PIPELINE_SCHEDULER_TICK_SECONDS` inside the API process) claims a due pipeline by moving `nextRunAt` with a conditional update, so several instances fire it once; missed fires collapse into the latest one, and one whose window already closed is skipped.
- A fire resumes the pipeline's `paused` run (new window), skips while a run is still `queued`/`running`, or starts a new run (409 `PIPELINE_RUN_ACTIVE` for "Run now" in that case). "Run now" has no window.
- Each tick also pauses runs whose window closed (`paused`; their queued jobs wait), and re-queues leases that expired without a result (`attempts + 1`, `failed` after `SCAN_JOB_MAX_ATTEMPTS`).

**Leasing** (`POST /workers/manager/lease`, `manager-lease.service.ts`): records the manager, then leases with `SELECT … FOR UPDATE SKIP LOCKED` up to `max_parallel × WORKER_LEASE_JOBS_PER_SLOT` queued jobs of `queued`/`running` scans with at least a minute of window left, for enabled workers the manager offers, oldest scan and earliest step first. Without work it holds the request up to `wait_seconds` (at most 60) and answers 204. `leaseJob()` (`manager-job.ts`) builds the job list entry: `deadline` = the step's max duration from now, cut at the window's end; `params.max_duration_seconds` follows it; the lease lasts until the deadline plus `WORKER_LEASE_GRACE_SECONDS` (the manager sends no heartbeats).

**Job lifecycle:** after each stored result, `pipelineRuns.onResultStored()` checks the job's current lease. Once every task index has reported, the job is `completed` (and the next step gets its jobs), re-queued when the time window cut it (a `partial` result stopped at the deadline; not counted as an attempt) or when every task failed with attempts left, or `failed`. A scan with nothing queued or leased ends `completed`, `failed` (every job) or `stopped`. `POST /scans/{id}/stop` stops queued jobs at once; leased ones finish their run first.

## Scan results

The result a worker sends for a job is fixed in [`docs/worker-result-format.md`](../../docs/worker-result-format.md) (locked). It is the backend's single input for scan data. Results storage, diffs between scans, the dashboard, signatures, export/import and DefectDojo all build on it. That document also lists what the backend derives itself: target membership, detections, coverage, new/gone/changed and host lifecycle.

`resultsService.ingest(result, { taskIndex, taskCount })` (`modules/results/`) takes a result already validated with `WorkerResultSchema` and writes it in one transaction.

`POST /workers/manager/results` (`modules/workers/`) calls it. worker-manager uploads one worker run's result per request, `{ task_index, task_count, result }`, with `Authorization: Bearer <WORKER_TOKEN>` (`middleware/worker-token.ts`: no user session, compared in constant time; without `WORKER_TOKEN` the endpoint answers 503). A leased job that the manager split into tasks comes back as several results under one `leaseId`, told apart by `task_index`; the results of a scan are tied together by `scanId`. The reply is `{ status: "ingested" | "duplicate", resultId }`. The job must exist as a `ScanJob` (leased through `POST /workers/manager/lease`); a stored result then moves the job on (see [Pipelines](#pipelines-scheduling-and-leasing)). There is no heartbeat endpoint.

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
- **Idempotency:** `(leaseId, taskIndex)` is unique on `ScanJobResult`. A result resent under the same lease and task is a no-op that returns the stored id; another task of the same lease is a new result.
- **Scope:** the job must exist and belong to `scan.scanId` (404 / 400). Every address must be inside the job's `targets`, and every open port inside the scan's `ports` (400 otherwise, nothing is written).
- **Separate runs:** `(resultId, ip)` is unique. A new lease writes its own host and port observations, even when another result in the same scan reported the same address. Same-lease resends remain idempotent.
- **Seen window:** results may arrive out of order, so ingest only ever widens `firstSeenAt`/`lastSeenAt`.
- **Fingerprint** (`fingerprint.ts`): SHA-256 over the port's comparable view (`comparable.ts`): service detection, SSH host key and, per HTTP endpoint, status, title, final path, technology headers by value and security headers by presence (lists in `contracts/src/scans/compared-fields.ts`), cookie names and flags, certificate, TLS version, favicon and probe statuses. Request-dependent values (dates, cookie values, body hashes, query strings) are left out so unchanged pages do not show up as changed. After changing the view, run `db:refingerprint`: it rebuilds each stored port from its columns and decrypted `details` and rewrites fingerprints that differ.
- Ingest does not touch `ScanJob` (status, timings): the results endpoint calls `pipelineRuns.onResultStored()` after it.

## Browsing scan results

Users reach hosts through scans: `/scans` → a scan → the hosts it saw (`modules/scans/scan-results.service.ts`). All of it needs `scans:read`.

| Endpoint | What it returns |
|---|---|
| `GET /scans` | Every scan, newest first: status, timing, hosts by status (`up`, `down`, `timeout`, `cancelled`, `failed`) and open ports |
| `GET /scans/{id}` | The same plus parameters, jobs by status, the base scan, the change counts and the coverage of both scans |
| `GET /scans/{id}/hosts` | The scan's hosts with their services, as this scan saw them, paged in address order. Filters: `q` (IP prefix, hostname, tag, port, service name/product, HTTP title), `triage` (host or any service), `change` |
| `GET /scans/{id}/hosts/{hostId}` | One host in that scan: decrypted HTTP details, banner, NSE scripts, the base scan's observation of each port (`before`), what changed field by field, and the address's scan history |

All three scan endpoints take `?base=<scanId>` to compare with a chosen scan instead of the previous one; it must be older (`400 BASE_SCAN_NOT_OLDER` otherwise, 404 if it does not exist). The frontend's compare page (`/app/scans/compare`) is built on it.

When several worker results in one scan report the same IP, the stored observations remain
separate. These endpoints select one effective observation per IP: `up` takes precedence over
`down`, then `timeout`, `cancelled` and `failed`; among matching statuses Nmap takes
precedence over discovery, then the latest observation. Scan counters, diffs and history
use that same selection, so a retry does not duplicate a host in the scan view.

**Changes** (`scan-diff.ts`, PDF items 8–9) compare a scan with its **base scan**: `?base=` if given, otherwise the previous scan (by `createdAt`) that has results. They follow the rules in [`docs/worker-result-format.md`](../../docs/worker-result-format.md#what-the-backend-derives):
- Hosts are keyed by IP and services by IP + protocol + port. A service is `changed` when its `fingerprint` differs.
- A host is `new` (up now, answered `down` in the base scan), `gone` (up before, `down` now), `changed` (a service is new, gone or changed), `unchanged`, or `unknown`: up before and `timeout`/`cancelled`/`failed` now, or up now while the base scan got no answer from it or did not cover it. Only conclusive answers count, and a base host outside this scan's coverage is left out. Each host carries `baseStatus` (what the base scan got, `null` if it did not cover the address).
- `coverage` on the scan counts addresses with a conclusive answer in both scans, only in the base scan, or only in this one.
- The first scan has no base scan: every `change` is `null`.
- The diff reads only IPs, statuses and fingerprints, so it runs over a whole scan per request; details are loaded for the requested page only. The list's plaintext HTTP summaries come from `httpSummaries()`, without decrypting anything; each service's `before` is the base scan's plaintext summary of the port.

**What changed** (`field-changes.ts`): the host detail compares the two observations of each `changed` port on the same comparable view the fingerprint hashes, and returns `fieldChanges` as `{ field, endpoint, key, before, after }` (`service.version`, `http.title`, `http.header` with the header name as `key`, `tls.cert`, `http.probe`, …; `null` = absent on that side). Hostnames that appeared or went are host-level `fieldChanges`. Only the detail decrypts, so the list stays cheap.

**Lifecycle** (`host-lifecycle.ts`, the PDF's "after how long without an answer is a host inactive?"): every host in a scan carries its lifecycle as of that scan, from its latest 10 conclusive answers (`up`/`down`) in that scan and earlier ones; `timeout`, `cancelled` and `failed` say nothing. `inactive` after 3 `down` in a row, `unstable` after 2 up/down switches, `missing` after fewer misses, `active` otherwise (constants in `scan-results.schema.ts`). A pair comparison still reports a host `gone` after one `down`: the lifecycle tells a blip from a host that is really gone.

**Export and priorities** (`GET /scans/{id}/changes?base=&format=json|csv`): every change between the two scans, one row each. A row is a host that is new, gone or unknown (`before`/`after` are the statuses), a port that opened or closed (`before`/`after` name the service), or one changed field. `change-priority.ts` rates each row `high`, `medium` or `low` with a `reason`:
- **high:** a new host; a risky port opening (remote access, file sharing, databases); an admin or login path that started answering 2xx; a changed SSH host key; a self-signed certificate;
- **medium:** software, page, certificate or technology-header changes; a removed security header; weakened cookie flags; a gone host that is `inactive`; a host that came back while `unstable`;
- **low:** everything else. A returning unstable host's ports are `low`: they are not newly exposed.

CSV is RFC 4180 with a leading `'` on cells that start with `=`, `+`, `-` or `@`, so spreadsheets do not run them (CSV injection). The comparison page downloads both formats.

**Export of a scan** (`GET /scans/{id}/export?format=json|csv`, `scans:read`): the scan's own view of every address it covered, whatever the base scan saw, with the notes, tags, triage and corrections of its hosts. The format is in [`docs/scan-export-format.md`](../../docs/scan-export-format.md).
- `scanResultsService.forExport()` reads the effective observations (the merged view when several workers saw a host) in batches; `scan-export.ts` writes them one host per line, so the response is streamed and a scan with many page bodies is never held in memory whole.
- JSON lists the addresses that are not `down` in the worker result's host shape, decrypted, and names the covered blocks in `coverage`: an address in them without an entry is `down`. CSV (`contracts/src/scans/scan-csv.ts`) has one row per HTTP endpoint and the covered blocks as `down` rows.
- Once the status line is sent, a failure can only cut the connection: the controller logs it and destroys the response.

**Import of scan results** (`POST /scans/import?edits=skip|fill&name=`, `scans:read` + `scans:create`; `edits=fill` also `hosts:update`): the request body is the file itself, JSON or `text/csv`. `readScanJson` / `readScanCsv` (`contracts/src/scans/scan-import.ts`, the same code the import page previews with) recognize a scan export, one or more worker results, or a CSV of hosts and services.
- `scan-import.plan.ts` (pure) turns the file into a scan row, its jobs and one worker result per job. A scan export or CSV is batched with `planScanJobs`, and the covered addresses the file leaves out become `down` hosts; worker results are replayed as they are, one job each, with their worker id.
- `scan-import.service.ts` writes it in **one transaction**: the scan (`trigger = results_import`), the jobs (created `completed`, so a worker lease never picks one up) and every result through `resultsService.ingestWithin()`, the unchanged ingest. A failed import leaves no scan, host or service. An advisory lock allows one import at a time (`409 SCAN_IMPORT_RUNNING`).
- **Placement:** `Scan.createdAt` is when the file says the scan ran, never in the future, and a millisecond later than a scan that already has that time. Base scans, lifecycles and the dashboard order scans by it, so an older file can become the base scan of a newer scan.
- **Once:** `Scan.importKey` is the SHA-256 of the content (ids, export time and edits aside). The same file again answers `409 SCAN_ALREADY_IMPORTED` with `details.scanId`. Importing it twice would otherwise count every `down` answer twice in the lifecycle.
- **Ports:** `Scan.ports` is the file's port list widened by every port it reports open, so ingest's scope check holds.
- **Edits** (`hostsService.mergeEdits`): only with `edits=fill`, and only where the host or service has no value yet (tags are added, triage is set while `unreviewed`, a note while empty, a correction while null). Nothing a user set is overwritten (PDF item 14).
- At the end `ScanJobResult.receivedAt` is moved to the commit time: the vulnerability sync only looks two minutes back.

**Dashboard** (`modules/dashboard`, `GET /dashboard`, `scans:read`): the newest scan with results against its base scan: hosts up and open ports, change counts, how many known hosts are `unstable` or `inactive` as of that scan, and the 20 most important changes. Rows are grouped by `top-changes.ts` into one item per new, gone or unknown host (with the ports it opened or closed) and one per changed service; an item is as important as its most important row.

**DefectDojo sync** (`modules/defectdojo/`): `POST /defectdojo/sync` merges DefectDojo tags into host and service tags, sets triage on services still `unreviewed` and replaces `Service.remediationPlannedOn`/`slaDueOn`/`riskAcceptedUntil` (returned as `remediation` on every scan service). `POST /defectdojo/push` sends a scan's services (all, or the selected hosts and services) as `Generic Findings Import` findings, importing once and reimporting into the same test later (`DefectDojoPush` rows keep the test id). Rules: [`docs/defectdojo-integration.md`](../../docs/defectdojo-integration.md#sync-into-subsurf-implemented) and [push](../../docs/defectdojo-integration.md#push-from-subsurf-implemented).

**Edits** (`modules/hosts/`, `hosts:update`): `PATCH /hosts/{id}` (note, tags, triage) and `PATCH /hosts/{id}/services/{serviceId}` (the same plus `nameOverride`/`productOverride`/`versionOverride`, `null` clears one). They write the `Host`/`Service` assets, which ingest never touches, so an edit made from any scan shows in every scan and survives later ones (PDF item 14). Triage is `unreviewed | reviewed | important | false_positive`.

**Editing and deleting a scan** (`modules/scans/scan-edits.service.ts`):
- `PATCH /scans/{id}` (`scans:update`: admin, editor, analyst) changes the scan's `name` and `note`, in any state of the scan (PDF item 14). The note is encrypted at rest. Nothing else is editable: the results are what was observed, and ingest's scope check depends on the parameters.
- `DELETE /scans/{id}` (`scans:delete`: admin, editor) removes the scan with its jobs, results, observations and DefectDojo push records (cascades). `Host` and `Service` rows stay with their notes, tags and triage; their `firstSeenAt`/`lastSeenAt` are not recomputed. Diffs, lifecycles and the dashboard are computed per request, so the remaining scans are compared with each other from then on. A re-match of the services is queued for the vuln-sync process, because a service's matches are judged on its newest observation. A `running` scan answers `409 SCAN_RUNNING`.

**Bulk tags** (`POST /scans/{id}/hosts/tags`, `scans:read` + `hosts:update`): adds or removes one tag on the scan's hosts inside the given IPv4 addresses and CIDRs (`parseHostSelectors`/`selectorRanges` in `contracts/src/hosts/host-selectors.ts`, shared with the dialog). It matches the hosts the scan lists, gone and unknown included, whatever filters the table has. One raw SQL statement updates every matched `Host`; hosts already at `MAX_TAGS` (20) are skipped, so their edit dialog still validates. The response counts `matched`, `changed`, `unchanged` (already had it / never had it) and `limitReached`.

## Vulnerabilities

`modules/vulnerabilities` mirrors public vulnerability databases into PostgreSQL and matches the services the scans find against them. Two sources are implemented: **NVD** (CVEs with CPE applicability) and **OSV.dev** (advisories per package ecosystem, Debian and Alpine packages included). Everything heavy runs in a separate process, `src/vuln-sync.ts` (`pnpm vulns:sync`), never in the API.

### How a source plugs in

```
 feed / zip ──► VulnerabilitySource (sources/registry.ts: nvd, osv)
                  └─► NormalizedVulnerability { canonicalId, severity, …, criteria: [{ kind, matchKey, data }] }
 Service (newest PortObservation) ──► components/ ──► Component { cpe, version, distro }
                  └─► matchers/registry.ts (cpe, package): keysFor() + evaluate() ──► verdict
```

- A **source** (`sources/source.ts`) knows only its format and transport. It emits `upsert`, `checkpoint` (its own cursor), `scopeCompleted` and `needsFull` events; `sync/sync.service.ts` writes them. Adding one: implement the interface, add its factory to `FACTORIES` in `sources/registry.ts`, add its id to `VULN_SOURCES`.
- A **criterion** has a `kind`, a version-independent `matchKey` and `data` (JSONB): `cpe` (`cpe:a:openbsd:openssh`, version ranges) from NVD, `package` (`pkg:Debian:openssh`, OSV ranges per release) from OSV. A new source that describes software the same way reuses a matcher; a new data model adds one matcher in `matchers/` (`defineMatcher` with a zod schema for its data). The tables do not change.
- **Canonical id:** records merge across sources by CVE: the CVE in the record's id (`DEBIAN-CVE-2023-48795`), else the single CVE among `aliases` and `upstream`, else the record's own id.

### Sync

- **Schedule:** incremental every `VULN_SYNC_INTERVAL_HOURS` (8), full every `VULN_FULL_SYNC_INTERVAL_DAYS` (7) and on the first run; "Sync now" and the source toggle in the UI queue a `VulnerabilityJobRequest` that the process picks up within `VULN_SYNC_POLL_SECONDS`. One process works at a time: a lease in `VulnerabilitySyncState` (database clock, renewed every minute); cursors and sweeps are written only while it is held. Runs are recorded in `VulnerabilitySyncRun`.
- **NVD:** full = every year file `nvdcve-2.0-<year>.json.gz` (streamed, never loaded whole), then `modified`; incremental = `modified` only (the last 8 days), skipped when its `.meta` checksum is unchanged; older than 7 days → a full sync. The `.meta` sha256 is checked against the uncompressed bytes. `Rejected` CVEs are kept as `rejected`, without criteria.
- **OSV:** full = each ecosystem's `all.zip`; incremental = `<ecosystem>/modified_id.csv` read up to the cursor, changed records fetched one by one (more than `OSV_INCREMENTAL_MAX_RECORDS` → the zip). `withdrawn` records become `withdrawn`. `MAL-*` (malicious packages) and `DSA-`/`DLA-`/`DTSA-` (bundles of CVEs the `DEBIAN-CVE-*` records cover) are skipped.
- **Writes:** batches of 1,000 through `jsonb_to_recordset`; a record whose `sourceModifiedAt` and status did not change only gets `lastSeenAt`, a changed one gets its criteria replaced. One row per record and match key, so a CVE listing hundreds of firmware versions is one row.
- **Corrected entries** (the reason to re-sync often): a changed record replaces its criteria; a rejected or withdrawn one stops matching; a record a complete full sync no longer sees is withdrawn (`removed_from_source`), never deleted. That sweep refuses to withdraw more than `VULN_SWEEP_MAX_RATIO` of a scope (a truncated download), and a failed or partial run never sweeps.
- **Offline:** downloads land in `VULN_CACHE_DIR` in each source's layout, so the directory is a mirror: `pnpm vulns:mirror <dir>` on a connected machine, then `NVD_FEED_URL=file://<dir>/nvd` and `OSV_BASE_URL=file://<dir>/osv` in the lab. `pnpm vulns:import --source <id> <file>` imports a single file.

### Matching

- **Input:** nmap's own fields of the service's newest observation (by scan, then observation time): `serviceCpe`, plus `serviceVersion`/`serviceExtraInfo`/OS CPEs for the distribution and package revision (`9.2p1 Debian 2+deb12u3`, `Ubuntu 3ubuntu13.5`). User corrections of product or version do not change matching. Application CPEs without a version, and nmap's guesses (`5.X`), match as `potential` (`version_unknown`); OS and hardware CPEs without a version are only platform hints.
- **cpe matcher:** NVD version and update are joined (`9.6` + `p1` = `9.6p1`), ranges compared with `versioning/generic.ts` (rc < release < p1). `AND` configurations (vulnerable only on a platform) check the service's OS hints: no hint → `potential` (`platform_condition`).
- **package matcher:** `PackageMapping` (CPE vendor:product → package per ecosystem, starter rows in the migration, editable in the UI) leads a component to OSV packages; distribution ecosystems only when the service runs on that distribution. The Debian revision is compared with dpkg rules on the exact release (epochs ignored: banners never show them).
- **Backports:** `matching/resolver.ts` merges every source's verdict per CVE. When the distribution's own data on the exact package revision says "fixed", the NVD hit becomes `potential` (`fixed_by_backport`); an NVD hit on a distribution package without such data is `potential` (`distro_backport_possible`).
- **When:** after every sync (all services), after a mapping or source change, and for the services of new scan results: the process follows `ScanJobResult.receivedAt` with a 2-minute look-back (ingest commits up to 60 s after the row is stamped), so `ingest()` does not change. A match that no longer holds is **retracted**, not deleted, with a reason (`service_changed`, `criteria_changed`, `source_withdrawn`, `source_disabled`), and comes back with its `firstMatchedAt` if it holds again. The analyst's verdict lives in `ServiceVulnerabilityTriage` per service and CVE, so it survives both.
- **Reading:** matches belong to the Service asset; the scan views show them whatever scan is open (`basis.scanId` says which scan they were evaluated on). Summaries count each CVE once and leave false positives out; the host list filters by `vulnerability=any|critical|high|kev`.

### Numbers and limits

Measured on 2026-11-22 (MacBook, local Docker PostgreSQL 19, real downloads):

| | NVD | OSV (7 default ecosystems) |
|---|---|---|
| Records | 430,357 (411,161 active, 19,196 rejected) | 122,808 (120,629 active, 2,179 withdrawn) |
| Download | 25 year files + `modified`, ~260 MB gz | ~390 MB of zips |
| First full sync | ~8 min | ~3 min |
| Later full sync | ~7 min (22 records changed) | — |
| Criteria rows | 927,367 (`cpe`) | 141,499 (`package`) |

The tables take about 1 GB (`Vulnerability` 592 MB, `VulnerabilityCriterion` 418 MB); the process peaks at about 660 MB of memory. Re-matching the demo network's 644 services takes seconds. On the demo data a full sync gives 2,924 confirmed and 5,842 potential matches.

- Many 2024–2026 CVEs have no CPE configuration in NVD yet (NVD's analysis backlog): NVD cannot match them; OSV often can.
- Ubuntu is not in the default `OSV_ECOSYSTEMS` (820 MB): NVD hits on Ubuntu hosts are `potential`. The distribution parser already reads Ubuntu revisions, so adding `Ubuntu` to the list is enough.
- Attribution: "This product uses data from the NVD API but is not endorsed or certified by the NVD." OSV data comes from many databases under their own licenses (GitHub Advisory Database CC-BY 4.0, Alpine SecDB CC-BY-SA 4.0, …); the admin page shows the notice.

## Reports

`modules/reports` builds read-only reports from the stored observations, on request (nothing is precomputed or stored). Every route needs `scans:read`, like browsing the results. The frontend renders them as printable pages with JSON and CSV downloads.

| Endpoint | Report |
|---|---|
| `GET /reports/scans/{id}/summary` | Post-scan summary: execution (job results, stop reasons, workers, time per phase), results, changes against the base scan, top hosts, ports and technologies, triage counts |
| `GET /reports/scans/{id}/findings` | Interesting findings and an analytical priority per host |
| `GET /reports/scans/{id}/technologies` | Technologies and CMSs with versions and confidence, plus groups of similar services |
| `GET /reports/scans/{id}/exposure` | Open ports by port and by /24 network |
| `GET /reports/scans/{id}/triage` | Verdicts, new unreviewed services, DefectDojo remediation dates (overdue, due within 14 days, risk acceptance ending within 30 days) |
| `GET /reports/scans/{id}/tags?tag=` | Every tag of the scan; with `tag`, the hosts carrying it on the host or a service |
| `GET /reports/diff?from=&to=` | Any two scans, in either order, by the rules of `scan-diff.ts`, with each changed service before and after and which fields differ. 400 `SAME_SCAN` for one scan twice |
| `GET /reports/ips/{ip}` | One address in every scan: status timeline, ports opened, closed and changed, each service's distinct states, findings and technologies from the latest `up` answer |
| `GET /reports/stability?scanId=&window=&inactiveAfter=` | Hosts across the latest `window` scans (default 10): `flapping`, `unresponsive`, `inactive` (`down` in the last `inactiveAfter` scans, default 3), `going-quiet`, `unstable-ports`, `returned` |
| `GET /reports/time-of-day?scans=&utcOffsetMinutes=` | Availability and ports by part of the day (night, morning, afternoon, evening in the viewer's time zone); needs scans from two parts of the day |

**How the reports decide** (all of it passive: the rules read what the worker already collected and send nothing to any host):
- **Findings** (`findings.ts`): fixed rules with a fixed severity, e.g. a database port reachable (high), staging/debug pages and `/server-status` (high), expired certificates (high), admin panels by title, probe or `www-authenticate` (medium), cleartext protocols and logins over plain HTTP (medium), software older than a supported version (medium), self-signed certificates, cookies without `Secure`/`HttpOnly`, CORS `*`, default pages (low), missing security headers and versions in headers (info). One finding per rule and service.
- **Priority:** severity weights (10, 5, 2, 0.5) summed per host, +3 per new service, ×1.5 when the host or a service is triaged `important`. `false_positive` hosts and services are left out.
- **Technologies** (`technologies.ts`): service detection, software headers, `<meta name="generator">`, page content markers, cookie names, titles and probe paths, merged per service under one name (aliases such as `Apache/…` and `Apache httpd`). Confidence is `high` for two or more sources, `medium` for one explicit source (service detection, a header or a generator tag), `low` for a cookie, title or path alone.
- **Stability** (`history-reports.ts`): only addresses `up` at least once in the window are loaded. A timeout is never counted as `down`, so a host that stops answering is `unresponsive`, not `inactive`.
- `scanResultsService.hostsForReport(scanId, baseScanId?)` gives the reports the same effective observations and diff as the scan views, against any base scan.

## Demo data

`pnpm db:seed:hosts` (after `pnpm db:reset` or `pnpm db:seed`, which create the admin who owns the scans) fills the database with realistic scan results to build features on (`src/demo/`, entry `prisma/seed-hosts.ts`):
- **Network:** 10.40.0.0/18 (16,384 addresses, 64 jobs of 256), about 250 live hosts with domains under `campus.example`: CMSs (WordPress, Joomla, Drupal, Moodle, MediaWiki), CI and admin panels (Jenkins, GitLab, Tomcat manager, phpMyAdmin, Grafana, Kibana, Zabbix), staging (`x-environment: staging`, Django debug page, Swagger UI), databases, Linux and Windows servers, cameras, printers, UPS, BMCs and NAS boxes. Certificates include self-signed, expired and expiring ones; cookies lack `Secure`/`HttpOnly` here and there.
- **Four runs** through the real `resultsService.ingest()`: nights of 2026-11-20, -21 and -22 (01:00 UTC) and the afternoon of the 21st (13:00 UTC).
  - The second run has new, gone and unknown hosts, upgraded software, opened and closed ports, a renewed certificate and a maintenance page, and its last job stops at the deadline (`partial`, `stopReason: "deadline"`, 128 addresses `cancelled`), so the scan ends `stopped`.
  - Runs 3 and 4 exercise the lifecycle: hosts gone in run 2 stay down (inactive by run 4), two workstations reboot during the afternoon run and a lab host and a test proxy come and go (unstable), RDP opens on a workstation and a phpMyAdmin panel appears in run 4. Runs 1 and 2 are the same as before they were added, so a database seeded earlier only gains runs 3 and 4.
- **Deterministic and idempotent:** fixed scan ids and lease ids, a seeded PRNG. Re-running skips what is already there; a fresh copy needs `pnpm db:reset` first. It takes about 10 s.
- `pnpm db:seed:hosts --json <dir>` also writes every worker result as `run-N/job-NNN.json`. `POST /scans/import` takes such a file, or several joined into one JSON array.
- The generator's tests (`src/demo/demo.test.ts`) check that every result passes `WorkerResultSchema`, that the second run really differs and that the fourth has unstable and inactive hosts.
- **Vulnerabilities:** before the runs, the seed loads `src/demo/vulnerabilities/{nvd,osv}.json` (real NVD and OSV records for the demo network's software) through the sources' parsers, and re-matches services after each run, so the second run's upgrades retract what they fixed. The slice leaves the sources' cursors alone: the first real sync is still a full one. `src/demo/vulnerabilities/build-fixture.ts` rebuilds it from a database with the demo scans and a full sync of every source.

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
| `COOKIE_SECURE` | production only | Secure flag on the session cookies. `false` for plain http opened by IP or hostname (browsers drop Secure cookies over http except on `localhost`); keep it on behind HTTPS |
| `WORKER_TOKEN` | — | Bearer token of the scan workers on `/workers/*`, ≥ 16 characters; unset turns those endpoints off (503). worker-manager sends it as `WORKER_MANAGER_TOKEN`. Production refuses the `.env.example` value |
| `ADMIN_EMAIL` `ADMIN_PASSWORD` | — | First admin (startup while there are no users, and the seed). Production refuses the example password |
| `SEED_DEMO_USERS` `DEMO_USER_PASSWORD` | `false` | Seed only: demo accounts for the editor, analyst and viewer roles |
| `SCAN_DEFAULT_PORTS` | 28 common TCP ports | Ports snapshotted onto every queued scan (`22,80,8000-8100` syntax) |
| `SCAN_DEFAULT_MAX_RATE` | `100` | Packets per second a worker may send for one job |
| `SCAN_BATCH_SIZE` | `256` | Addresses per scan job, a power of two from 16 to 1024 |
| `SCAN_ALLOWED_PORTS` | `1-65535` | The only TCP ports a pipeline step may scan (`PORTS_NOT_ALLOWED` otherwise); `SCAN_DEFAULT_PORTS` must stay inside it |
| `SCAN_JOB_MAX_ATTEMPTS` | `3` | A job whose lease expired, or whose every task failed, this many times is `failed` |
| `PIPELINE_SCHEDULER_ENABLED` | `true` | Run the pipeline scheduler in this API process (tests turn it off) |
| `PIPELINE_SCHEDULER_TICK_SECONDS` | `15` | How often the scheduler fires due pipelines, pauses closed windows and reclaims leases |
| `WORKER_LEASE_GRACE_SECONDS` | `300` | A lease outlives the job's deadline by this long, for result uploads |
| `WORKER_LEASE_JOBS_PER_SLOT` | `2` | Jobs per lease request: `max_parallel` × this |
| `VULN_SOURCES` | `nvd,osv` | Vulnerability sources to run, from the registry; the order is the preference when two describe the same CVE |
| `VULN_SYNC_INTERVAL_HOURS` | `8` | Incremental sync of each source every N hours |
| `VULN_FULL_SYNC_INTERVAL_DAYS` | `7` | Full sync (which also withdraws records the source dropped) every N days |
| `VULN_SYNC_POLL_SECONDS` | `30` | How often the sync process checks for requests from the API and new scan results |
| `VULN_SWEEP_MAX_RATIO` | `0.05` | A full sync that would withdraw more than this share of a scope's records (and more than 25) fails instead |
| `VULN_CACHE_DIR` | `.cache/vulnerabilities` | Downloads, in each source's own layout: also an offline mirror |
| `NVD_FEED_URL` | `https://nvd.nist.gov/feeds/json/cve/2.0` | NVD JSON 2.0 feeds; `file:///…/nvd` for a mirror |
| `NVD_FIRST_YEAR` | `2002` | First CVE year file of a full sync |
| `OSV_BASE_URL` | `https://storage.googleapis.com/osv-vulnerabilities` | OSV bulk export; `file:///…/osv` for a mirror |
| `OSV_ECOSYSTEMS` | `Maven,Go,Packagist,PyPI,Debian,Alpine,npm` | OSV ecosystems to mirror (each is a zip; Ubuntu alone is 820 MB) |
| `OSV_SKIP_PREFIXES` | `MAL-,DSA-,DLA-,DTSA-` | Record ids left out: malicious-package reports, Debian advisories that bundle CVEs |
| `OSV_INCREMENTAL_MAX_RECORDS` | `2000` | More changes than this since the last sync: read the ecosystem's whole zip instead |
| `DEFECTDOJO_URL` `DEFECTDOJO_API_TOKEN` | — | DefectDojo API for the sync (local: `http://localhost:8080` and the dev token from `docker/README.md`). Unset = the sync answers 503 `DEFECTDOJO_NOT_CONFIGURED` |

## Docker

```bash
docker build -f apps/backend/Dockerfile .      # from the repo root
```

A multi-stage build on `node:26.13.1-slim` using `pnpm deploy`; the process runs as `USER node`. `docker/docker-compose.yml` runs it in the `app` profile: `backend-migrate` (migrations), `backend` and, with the `vulns` profile, `vuln-sync` ([`docker/README.md`](../../docker/README.md#everything-in-docker)). The same image runs migrations: `node_modules/.bin/prisma migrate deploy`, and the vulnerability sync process: `node dist/vuln-sync.mjs` (one container of it per deployment; give `VULN_CACHE_DIR` a volume).
