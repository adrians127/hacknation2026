# @hacknation/backend

The REST API of the Attack Surface Intelligence system: it stores targets, configurations and scan results, hands out jobs to workers and serves data to the frontend. Only the backend writes to the database.

## Stack

- **Node 26** + **TypeScript 7** (`tsc` is used for type-checking only)
- **Express 5**: async handlers, rejected promises reach the error handler
- **Prisma 7.10** + `@prisma/adapter-pg`, **PostgreSQL 19** (from `docker/`)
- **zod 4**: request validation with schemas from `@hacknation/contracts`
- **pino** / **pino-http**: logging
- **tsdown** (build, rolldown) · **tsx** (dev, watch) · **Vitest** (tests) · **oxlint** (lint, type-aware)

> Prisma 7.10.1 warns on install that it officially supports Node 20/22/24. On Node 26, `generate`, queries and the Docker image all work. Prisma 8 is still in RC, so we stay on 7.x.

## Commands

```bash
pnpm --filter @hacknation/backend dev          # tsx watch, :3001
pnpm --filter @hacknation/backend build        # tsdown -> dist/index.mjs
pnpm --filter @hacknation/backend start        # node dist/index.mjs
pnpm --filter @hacknation/backend test         # vitest (no database needed)
pnpm --filter @hacknation/backend db:migrate   # prisma migrate dev (new migration)
pnpm --filter @hacknation/backend db:studio    # Prisma Studio
pnpm db:reset                                  # from the repo root: drop + all migrations + seed
```

Swagger UI is at `http://localhost:3001/docs` (only when `NODE_ENV=development`) and serves the committed `openapi.json` from the contract.

## `src/` structure

```
app.ts                 buildApp(): middleware -> /v1 -> notFound -> errorHandler
index.ts               listen, DB connection check, graceful shutdown
config/                env.ts (zod + process.loadEnvFile), database-url.ts (DB_* -> URL)
lib/                   prisma, logger, http-error, api-docs
middleware/            validate (zod from the contract), error-handler, not-found
routes/index.ts        apiRouter: one apiRouter.use("/x", ...) line per module
modules/<feature>/     <feature>.routes.ts | .controller.ts | .service.ts | .test.ts
generated/prisma       Prisma Client (gitignored, generated in postinstall)
```

**New module:** schemas in `packages/contracts/src/<feature>/` (+ `pnpm generate`), then `src/modules/<feature>/` and one line in `routes/index.ts`. A route declares its contract with `validate({ params, query, body })`, and when a request does not match, the `ZodError` is turned into a 400 automatically.

## Prisma

- `prisma.config.ts`: schema path, migrations, seed and the URL built from `DB_*`. A placeholder URL lets `prisma generate` run on a fresh clone without a database.
- `prisma/schema/schema.prisma`: only the generator and the datasource. Models live in `prisma/schema/<module>/<model>.prisma` (one file per model, in a folder named after the module in `src/modules/` that owns the table).
- Every relation field needs an `@@index`, because Prisma does not create indexes on foreign keys in Postgres.
- Fields holding sensitive data must be encrypted at rest (requirement 16 in the PDF), e.g. AES-256-GCM in a Prisma Client extension. To be designed together with the first models.

## Environment variables

`.env.example` documents every variable. `pnpm project:setup` copies it to `.env`. Real environment variables take precedence over `.env`. A missing or invalid variable stops the process at startup with a readable error.

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `development` = pretty logs, Swagger, stack traces in responses |
| `PORT` | `3001` | HTTP port |
| `LOG_LEVEL` | `info` | pino log level |
| `CORS_ORIGIN` | `http://localhost:3000` | allowed origin (with credentials) |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` `DB_SSLMODE` | — | Postgres connection in parts, no `DATABASE_URL` |

## Docker

```bash
docker build -f apps/backend/Dockerfile .      # from the repo root
```

A multi-stage build on `node:26.13.1-slim` using `pnpm deploy`; the process runs as `USER node`. The same image runs migrations: `node_modules/.bin/prisma migrate deploy`.
