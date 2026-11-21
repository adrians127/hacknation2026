# Attack Surface Intelligence

Prototyp narzędzia do cyklicznego discovery scanu dużej infrastruktury (>10 000 adresów IP): wykrywanie aktywnych hostów, usług, technologii webowych, CMS-ów, nagłówków i ciasteczek oraz śledzenie zmian między skanami. Projekt na HackNation 2026, zadanie od Centrum Bezpieczeństwa Informacji AGH ([`hackathon-zadanie.pdf`](hackathon-zadanie.pdf)).

## Struktura projektu

| Workspace | Opis | Dokumentacja |
|---|---|---|
| `apps/frontend` | React 19 + Vite 8 + React Router 8, Tailwind 4 + shadcn/ui, PL/EN | [README](apps/frontend/README.md) |
| `apps/backend` | Express 5 + Prisma 7 (PostgreSQL), REST API pod `/v1` | [README](apps/backend/README.md) |
| `apps/workers/*` | Workery skanujące w C++23 (nmap), budowane w Dockerze | [README](apps/workers/README.md) |
| `packages/contracts` | Schematy zod, z których generowany jest `openapi.json` | [README](packages/contracts/README.md) |
| `packages/api-client` | Typowany klient (openapi-typescript + openapi-fetch) | [README](packages/api-client/README.md) |
| `docker/` | PostgreSQL 19 i worker w Docker Compose | [README](docker/README.md) |

## Uruchomienie

### Wymagania

- **Node 26.13.1** (wersja w `.nvmrc`: `nvm install && nvm use`)
- **pnpm 12**: `npm i -g pnpm` (Node 25+ nie ma już corepack; właściwą wersję wymusza `packageManager` w `package.json`)
- **Docker** (Postgres i workery)

### Instalacja i start

```bash
pnpm install          # zależności + prisma generate
pnpm project:setup    # .env.example -> .env w każdej apce
pnpm db:up            # PostgreSQL w Dockerze
pnpm dev              # backend :3001 (Swagger: /docs) + frontend :3000
```

Worker nmap: `pnpm workers:up` (build obrazu i start).

### Pozostałe komendy

```bash
pnpm lint             # oxlint (type-aware)
pnpm check-types      # TypeScript 7
pnpm test             # Vitest
pnpm build
pnpm generate         # po zmianie kontraktu: openapi.json + typy klienta
```
