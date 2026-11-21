# @hacknation/contracts

The single source of truth for the API: **zod 4** schemas and the types derived from them, from which `openapi.json` (OpenAPI 3.1) is generated. That file is consumed by the frontend (through `@hacknation/api-client`), the backend (request validation, Swagger) and the C++ workers (endpoint definitions).

The package is source-only. There is no build step; consumers compile it together with their own code.

```
src/<feature>/<feature>.schema.ts    schemas + types (no OpenAPI imports, apps don't need them)
src/<feature>/<feature>.openapi.ts   path and component registration (side effect)
src/common/common.schema.ts          shared primitives, ErrorResponse
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
2. In `src/<feature>/<feature>.openapi.ts`, add `registry.registerPath({...})` with an `operationId`. Protected endpoints get `security: [{ bearerAuth: [] }]`.
3. Run `pnpm generate` from the repo root. It regenerates `openapi.json` and then the `api-client` types, in that order.
4. Commit the generated files. CI checks that they are up to date.

Importing in apps: `import { HealthResponseSchema } from "@hacknation/contracts/health/health.schema"`.

## Notes

- Registration order determines the order in `openapi.json`. That is why `import-registries.ts` imports the files sorted and one by one, so every regeneration produces an identical file.
- Avoid transformations (`.trim()`, `.transform()`) in request schemas. The backend calls `parse` without assigning the result, so a transformed value never reaches the handler.
