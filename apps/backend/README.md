# @hacknation/backend

REST API systemu Attack Surface Intelligence: przechowuje cele, konfiguracje i wyniki skanów, wydaje zadania workerom i serwuje dane frontendowi. Tylko backend pisze do bazy.

## Stack

- **Node 26** + **TypeScript 7** (`tsc` służy tylko do type-checku)
- **Express 5**: async handlery, odrzucone promisy trafiają do error handlera
- **Prisma 7.10** + `@prisma/adapter-pg`, **PostgreSQL 19** (z `docker/`)
- **zod 4**: walidacja requestów schematami z `@hacknation/contracts`
- **pino** / **pino-http**: logi
- **tsdown** (build, rolldown) · **tsx** (dev, watch) · **Vitest** (testy) · **oxlint** (lint, type-aware)

> Prisma 7.10.1 przy instalacji ostrzega, że oficjalnie wspiera Node 20/22/24. Na Node 26 `generate`, zapytania i obraz Dockera działają. Prisma 8 jest na razie w RC, więc zostajemy na 7.x.

## Komendy

```bash
pnpm --filter @hacknation/backend dev          # tsx watch, :3001
pnpm --filter @hacknation/backend build        # tsdown -> dist/index.mjs
pnpm --filter @hacknation/backend start        # node dist/index.mjs
pnpm --filter @hacknation/backend test         # vitest (nie wymaga bazy)
pnpm --filter @hacknation/backend db:migrate   # prisma migrate dev (nowa migracja)
pnpm --filter @hacknation/backend db:studio    # Prisma Studio
pnpm db:reset                                  # z roota: drop + wszystkie migracje + seed
```

Swagger UI jest pod `http://localhost:3001/docs` (tylko gdy `NODE_ENV=development`) i serwuje commitowany `openapi.json` z kontraktu.

## Struktura `src/`

```
app.ts                 buildApp(): middleware -> /v1 -> notFound -> errorHandler
index.ts               listen, próba połączenia z DB, graceful shutdown
config/                env.ts (zod + process.loadEnvFile), database-url.ts (DB_* -> URL)
lib/                   prisma, logger, http-error, api-docs
middleware/            validate (zod z kontraktu), error-handler, not-found
routes/index.ts        apiRouter: jedna linia apiRouter.use("/x", ...) na moduł
modules/<feature>/     <feature>.routes.ts | .controller.ts | .service.ts | .test.ts
generated/prisma       Prisma Client (gitignored, generowany w postinstall)
```

**Nowy moduł:** schematy w `packages/contracts/src/<feature>/` (+ `pnpm generate`), potem `src/modules/<feature>/` i jedna linia w `routes/index.ts`. Route deklaruje kontrakt przez `validate({ params, query, body })`, a gdy request się nie zgadza, `ZodError` zamienia się w 400 automatycznie.

## Prisma

- `prisma.config.ts`: ścieżka schematu, migracje, seed i URL z `DB_*`. Placeholder URL sprawia, że `prisma generate` działa na świeżym klonie bez bazy.
- `prisma/schema/schema.prisma`: tylko generator i datasource. Modele leżą w `prisma/schema/<moduł>/<model>.prisma` (jeden plik na model, folder nazwany jak moduł w `src/modules/`, który jest właścicielem tabeli).
- Każde pole relacji potrzebuje `@@index`, bo Prisma nie zakłada indeksów na FK w Postgresie.
- Pola z danymi wrażliwymi muszą być szyfrowane at rest (wymóg 16 z PDF), np. AES-256-GCM w Prisma Client extension. Do zaprojektowania razem z pierwszymi modelami.

## Zmienne środowiskowe

Plik `.env.example` opisuje każdą zmienną. `pnpm project:setup` kopiuje go do `.env`. Prawdziwe zmienne środowiskowe mają pierwszeństwo przed `.env`. Brakująca albo błędna zmienna zatrzymuje proces przy starcie z czytelnym błędem.

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `NODE_ENV` | `development` | `development` = ładne logi, Swagger, stack trace w odpowiedziach |
| `PORT` | `3001` | port HTTP |
| `LOG_LEVEL` | `info` | poziom pino |
| `CORS_ORIGIN` | `http://localhost:3000` | dozwolony origin (z credentials) |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` `DB_SSLMODE` | — | Postgres w częściach, bez `DATABASE_URL` |

## Docker

```bash
docker build -f apps/backend/Dockerfile .      # z roota repo
```

Wieloetapowy build na `node:26.13.1-slim` z `pnpm deploy`, proces działa jako `USER node`. Ten sam obraz uruchamia migracje: `node_modules/.bin/prisma migrate deploy`.
