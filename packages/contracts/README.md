# @hacknation/contracts

The single source of truth for the API: **zod 4** schemas and the types derived from them, from which `openapi.json` (OpenAPI 3.1) is generated. That file is consumed by the frontend (through `@hacknation/api-client`), the backend (request validation, Swagger) and the C++ workers (endpoint definitions).

The package is source-only. There is no build step; consumers compile it together with their own code.

```
src/<feature>/<feature>.schema.ts    schemas + types (no OpenAPI imports, apps don't need them)
src/<feature>/<feature>.openapi.ts   path and component registration (side effect)
src/common/common.schema.ts          shared primitives, ErrorResponse (+ error codes), IdParams
src/common/common.openapi.ts         cookieAuth and shared error responses for registrations
src/auth/permissions.ts              RBAC permission catalog and the four system roles
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
4. Commit the generated files. CI checks that they are up to date.

Importing in apps: `import { HealthResponseSchema } from "@hacknation/contracts/health/health.schema"`.

## Notes

- Registration order determines the order in `openapi.json`. That is why `import-registries.ts` imports the files sorted and one by one, so every regeneration produces an identical file.
- Avoid transformations (`.trim()`, `.transform()`) in request schemas. The backend calls `parse` without assigning the result, so a transformed value never reaches the handler.
