# SubSurf

[English](README.md) | **Polski**

SubSurf to prototyp systemu attack surface intelligence do cyklicznego skanowania dużych sieci (ponad 10 000 adresów IP). System:

- wykrywa aktywne hosty i otwarte usługi;
- rozpoznaje HTTP/HTTPS: technologie, CMS-y, nagłówki, ciasteczka i TLS;
- pokazuje, co zmieniło się między skanami;
- zapewnia RBAC, szyfrowanie danych w spoczynku, import i eksport CSV/JSON oraz integrację z DefectDojo.

Powstał na HackNation 2026 w ramach zadania przygotowanego przez Centrum Bezpieczeństwa Informacji AGH ([`hackathon-zadanie.pdf`](hackathon-zadanie.pdf)).

## Struktura projektu

Monorepo pnpm + turbo:

| Ścieżka | Co zawiera | Dokumentacja |
|---|---|---|
| `apps/frontend` | Interfejs webowy: React 19, Vite, Tailwind + shadcn/ui, EN/PL | [README](apps/frontend/README.md) |
| `apps/backend` | REST API pod `/v1`: Express 5, Prisma 7, PostgreSQL | [README](apps/backend/README.md) |
| `apps/workers/*` | Workery skanujące (masscan, naabu, nmap, httpx, tlsx) i uruchamiający je `worker-manager`; C++23, budowane w Dockerze | [README](apps/workers/README.md) |
| `packages/contracts` | Schematy zod wspólne dla frontendu i backendu; na ich podstawie generowany jest `openapi.json` | [README](packages/contracts/README.md) |
| `packages/api-client` | Typowany klient API generowany z `openapi.json` | [README](packages/api-client/README.md) |
| `docker/` | Docker Compose: PostgreSQL, DefectDojo, aplikacja, workery i laboratorium testowe | [README](docker/README.md) |

Dokumentacja szczegółowa poszczególnych części jest po angielsku.

## Uruchomienie

### Wszystko w Dockerze: jedno polecenie, bez Node i pnpm

Wystarczy Docker (Engine 28+, Compose 2.33+) na Linuksie. W katalogu głównym repozytorium:

```bash
docker compose -f docker/docker-compose.full.yml up -d --build
```

To polecenie:

- uruchamia aplikację z danymi demonstracyjnymi, DefectDojo i skanującym worker-managerem;
- uruchamia sieć testową (`docker/lab`) w podsieci `10.50.0.0/24`;
- zleca skan tej sieci.

| | |
|---|---|
| Aplikacja | `http://localhost:3000` |
| Dokumentacja API (Swagger) | `http://localhost:3001/docs` |
| DefectDojo | `http://localhost:8080` (`admin` / `hacknation`) |

Postęp wypełniania bazy i pierwszego skanu: `docker compose -f docker/docker-compose.full.yml logs -f bootstrap`. Zatrzymanie wszystkiego: `docker compose -f docker/docker-compose.full.yml down`; z flagą `-v` usuwa też dane. Szczegóły: [`docker/README.md`](docker/README.md#full-stack-with-the-lab).

### Praca deweloperska z pnpm

Najpierw zainstaluj:

- **Node 26.13.1**, wersję przypiętą w `.nvmrc`. Z [nvm](https://github.com/nvm-sh/nvm): `nvm install && nvm use`.
- **pnpm 12**: `npm i -g pnpm`. Node 25+ nie zawiera już corepacka, a pole `packageManager` w `package.json` wymusza właściwą wersję.
- **Docker**, dla PostgreSQL i workerów.

Następnie:

```bash
pnpm install          # zależności + prisma generate
pnpm project:setup    # .env.example -> .env w każdej aplikacji (uruchom ponownie po pullu)
pnpm db:up            # PostgreSQL w Dockerze
pnpm db:reset         # migracje + seed: role, administrator i konta demonstracyjne
pnpm db:seed:hosts    # opcjonalnie: demonstracyjne wyniki skanów
pnpm dev              # backend :3001 (Swagger: /docs) + frontend :3000
pnpm workers:manager:poll   # opcjonalnie, w drugim terminalu: worker-manager wykonujący skany
```

Pozostałe polecenia: `pnpm lint`, `pnpm check-types`, `pnpm test` (testy backendu wymagają `pnpm db:up`), `pnpm build` oraz `pnpm generate` po zmianie kontraktu. Polecenia związane z Dockerem opisuje [`docker/README.md`](docker/README.md).

### Konta

Oba sposoby uruchomienia tworzą te same lokalne konta (z `apps/backend/.env.example`; poza lokalnym środowiskiem zmień hasła):

| Konto | Rola | Hasło |
|---|---|---|
| `admin@hacknation.local` | Administrator | `admin-change-me-now` |
| `editor@hacknation.local`, `analyst@hacknation.local`, `viewer@hacknation.local` | Edytor, Analityk, Obserwator | `demo-password-2026` |
