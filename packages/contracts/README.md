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
scripts/                             registry, import-registries (sorted import), generate-openapi
openapi.json                         GENERATED, committed
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
4. Commit the generated files.

Importing in apps: `import { HealthResponseSchema } from "@subsurf/contracts/health/health.schema"`.

## Shared runtime logic: the target parser

The package is otherwise schemas only. `src/targets/target-input.ts` (with `ipv4.ts`) is the deliberate exception: the frontend runs it for the import form's live preview, and the backend runs the same code to validate (`ImportTargetsBodySchema`) and normalize the request. Keeping one copy guarantees that what the preview accepts is what the API accepts.

- Accepts IPv4 addresses, IPv4 CIDRs up to /16, IPv4 ranges (`10.0.0.1-10.0.0.200`, nmap's `10.0.0.1-200`) of at most a /16's worth of addresses, and domains. Rejects IPv6 and the reserved ranges in `RESERVED_IPV4_CIDRS`. Limits are in `TARGET_IMPORT_LIMITS`.
- A range is never stored as such: `collectTargets` splits it into the fewest CIDR blocks (`rangeToCidrs`), each one a separate `ip`/`cidr` target with the range's note. So the database and the workers only ever see the three `TargetKind`s.
- An entry inside another one (an IP in a CIDR, a CIDR in a range) gets a `covered_by` warning and is kept, since it may carry its own note. Addresses are counted once either way.
- `splitTargetText` is the line/CSV splitting step alone; the import form's entry field uses it so a pasted `value, note` line behaves as in the text tab.
- Issue and list-error codes are zod enums, so the frontend translates them.
- Tests: `pnpm --filter @subsurf/contracts test` (Vitest, next to the code). Code here must stay free of Node- and DOM-only APIs, since both apps compile it.

## Notes

- Registration order determines the order in `openapi.json`. That is why `import-registries.ts` imports the files sorted and one by one, so every regeneration produces an identical file.
- Avoid transformations (`.trim()`, `.transform()`) in request schemas. The backend calls `parse` without assigning the result, so a transformed value never reaches the handler.
