# @subsurf/contracts

The single source of truth for the API: **zod 4** schemas and the types derived from them, from which `openapi.json` (OpenAPI 3.1) is generated. That file is consumed by the frontend (through `@subsurf/api-client`), the backend (request validation, Swagger) and the C++ workers (endpoint definitions).

The package is source-only. There is no build step; consumers compile it together with their own code.

```
src/<feature>/<feature>.schema.ts    schemas + types (no OpenAPI imports, apps don't need them)
src/<feature>/<feature>.openapi.ts   path and component registration (side effect)
src/common/common.schema.ts          shared primitives, ErrorResponse (+ error codes), IdParams
src/common/common.openapi.ts         cookieAuth and shared error responses for registrations
src/auth/permissions.ts              RBAC permission catalog and the four system roles
src/targets/target-input.ts          target parser (manual/CSV/JSON → normalized targets), see below
src/targets/ipv4.ts                  IPv4 arithmetic: CIDRs, reserved ranges, merging, splitting
src/results/result.schema.ts         the result.json document (one scan run), see below
src/results/result.example.json      a complete example, also the test fixture
scripts/                             registry, import-registries (sorted import), generate-openapi,
                                     generate-json-schema
openapi.json                         GENERATED, committed
result.schema.json                   GENERATED, committed (JSON Schema 2020-12 of result.json)
```

## Flow

```
*.schema.ts ──► *.openapi.ts ──► pnpm generate ──► openapi.json ──► api-client (types) ──► frontend
     │                                                  └──────────► backend /docs, workers
     └──► backend validate() + controller types
```

## Adding an endpoint

1. In `src/<feature>/<feature>.schema.ts`, add schemas following the `XParamsSchema`, `XQuerySchema`, `XBodySchema`, `XResponseSchema` naming convention, plus `z.infer` types at the end of the file.
2. In `src/<feature>/<feature>.openapi.ts`, add `registry.registerPath({...})` with an `operationId`. Protected endpoints get `security: cookieAuth` and their error responses from `src/common/common.openapi.ts` (`unauthenticated`, `forbidden`, `errorResponse(...)`). Name the endpoint's permission in `description` (e.g. "Requires `users:read`.").
   - To get a named component (`$ref`), use the schema that `registry.register("Name", Schema)` **returns**. Only that instance carries the reference; passing the original schema inlines it.
   - A new permission goes into `src/auth/permissions.ts` (see [RBAC in the backend README](../../apps/backend/README.md#auth-and-rbac)).
3. Run `pnpm generate` from the repo root. It regenerates `openapi.json` and then the `api-client` types, in that order.
4. Commit the generated files. CI checks that they are up to date.

Importing in apps: `import { HealthResponseSchema } from "@subsurf/contracts/health/health.schema"`.

## Shared runtime logic: the target parser

The package is otherwise schemas only. `src/targets/target-input.ts` (with `ipv4.ts`) is the deliberate exception: the frontend runs it for the import form's live preview, and the backend runs the same code to validate (`ImportTargetsBodySchema`) and normalize the request. Keeping one copy guarantees that what the preview accepts is what the API accepts.

- Accepts IPv4 addresses, IPv4 CIDRs up to /16 and domains; rejects IPv6 and the reserved ranges in `RESERVED_IPV4_CIDRS`. Limits are in `TARGET_IMPORT_LIMITS`.
- Issue and list-error codes are zod enums, so the frontend translates them.
- Tests: `pnpm --filter @subsurf/contracts test` (Vitest, next to the code). Code here must stay free of Node- and DOM-only APIs, since both apps compile it.

## Scan results: `result.json`

`src/results/result.schema.ts` describes everything one scan run learns about its addresses, nested **subnet → host → port**. It is the format for exporting and importing results (PDF section 3), the target output of the HTTP/TLS fingerprinting stage and the input to DefectDojo export. `NmapResult` (`src/workers/`) stays the per-job wire format of `nmap-worker`; the backend merges those into this document. `pnpm generate` writes the JSON Schema to `result.schema.json` for non-TypeScript consumers (C++ workers, external tools). See `result.example.json` for a complete document.

```
scan            id, status/stop_reason, time window, previous_scan_id, scanner, parameters (ports, max_rate…)
summary         counts, changes per status
subnets[]       cidr, summary
  hosts[]       ip, hostnames (input/PTR/cert…), state, scan_status, latency, probe_attempts, os, interest, diff
    ports[]     port/protocol, state + reason, observed_at, service (nmap -sV), interest, diff
      endpoints[]     one per name the port was reached under (Host/SNI; null = bare IP): tls, http, error
      technologies[]  name, category, version, cpe, confidence, detected_by, evidence[]
      observations[]  key, kind, title, severity, confidence, detected_by, evidence[]
```

Conventions:

- JSON keys are `snake_case`, as in the worker contracts. Arrays are always present (possibly empty), and unknown scalars are `null`. The only optional field is `diff`.
- Raw facts (`service`, `endpoints`) are kept apart from interpretations (`technologies`, `observations`), so signatures added later can be re-run on stored data. Every interpretation names its `detected_by` (`nmap`, `builtin` or a custom `signature`) and its `evidence`, and each evidence item records which endpoint it came from.
- `confidence` is always a percentage (0–100). For `service` it is Nmap's `conf` × 10.
- `diff` compares against `scan.previous_scan_id` and is filled in by the backend, never by a worker. `missed_scans` and `is_unstable` back the "after how many silent scans is a host inactive" rule.
- Fields marked `x-sensitive` in the JSON Schema (cookie values, body excerpts) must be encrypted at rest. Workers leave them `null` unless configured otherwise.
- Path probes allow only `GET`/`HEAD`: detection, never login attempts.
- Beyond the shape, `parse` checks that every host lies inside its subnet, that no IP appears twice in a document, that no port appears twice on a host or endpoint hostname twice on a port, and that subnets have their host bits cleared.

| PDF requirement | Where |
|---|---|
| 3. Active hosts | `hosts[].state`, `state_reason`, `latency_ms` |
| 4. Service identification | `ports[].state`, `service` (product, version, CPE, banner, unrecognized fingerprint) |
| 5. HTTP/HTTPS: title, status, headers, cookies, TLS, redirects | `endpoints[].http.response`, `.cookies`, `.redirects`, `endpoints[].tls.certificate` |
| 6. CMS, framework, app server, IoT | `technologies[].category` |
| 7. Staging/test environment, admin panel | `observations[].kind` |
| 8–9. Comparing runs: new, disappeared, changed | `diff.status`, `diff.changes`, `summary.changes` |
| 10. Custom signatures (header, cookie, favicon hash, HTML, path, footer version) | `detected_by.kind = "signature"`, `evidence[].source`, `http.favicon`, `http.paths` |
| 16. Encryption at rest | `x-sensitive` fields |
| Scan time, windows, stopping, rate limit | `scan.duration_ms`, `window`, `stop_reason`, `parameters.max_rate` |
| Nice to have: unstable hosts, time-of-day differences | `probe_attempts`, `diff.is_unstable`, `observed_at` |
| Nice to have: "interestingness", DefectDojo findings | `interest`, `observations[].severity` and `key` (dedup) |

## Notes

- Registration order determines the order in `openapi.json`. That is why `import-registries.ts` imports the files sorted and one by one, so every regeneration produces an identical file.
- Avoid transformations (`.trim()`, `.transform()`) in request schemas. The backend calls `parse` without assigning the result, so a transformed value never reaches the handler.
