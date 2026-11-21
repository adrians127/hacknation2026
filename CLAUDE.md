# CLAUDE.md

Ten plik zawiera wskazówki dla Claude Code przy pracy w tym repozytorium. Celowo jest krótki: szczegóły każdej aplikacji są w jej `README.md` i **to one są źródłem prawdy**.

## Do czego jest to repozytorium

Prototyp **Attack Surface Intelligence** na hackathon HackNation 2026. Zadanie zleciło Centrum Bezpieczeństwa Informacji AGH. System cyklicznie skanuje rozległe sieci (>10 000 IP), wykrywa aktywne hosty i usługi, robi fingerprinting HTTP/HTTPS (tytuł, kod, nagłówki, ciasteczka, TLS, przekierowania), rozpoznaje technologie i CMS-y, obsługuje własne sygnatury detekcyjne i pokazuje zmiany między skanami. Do tego dochodzą RBAC, szyfrowanie danych at rest, import/eksport CSV/JSON i integracja z DefectDojo.

## Kontekst zadania: zawsze dołączaj PDF

**Przed każdą nietrywialną pracą dołącz do kontekstu plik `hackathon-zadanie.pdf` (w roocie repo) i przeczytaj go.** To jedyne źródło prawdy o wymaganiach, kryteriach oceny i ograniczeniach. Bez niego łatwo zbudować coś, co działa, ale nie spełnia zadania. Gdy cokolwiek w repo przeczy PDF-owi, wygrywa PDF.

Najczęściej potrzebne fragmenty (numery jak w PDF):

- **Sekcja 2, pkt 1–16**: wymagania funkcjonalne, m.in. import IP/CIDR/domen (formularz, CSV, JSON), diff skanów, własne sygnatury, RBAC z **czterema rolami** (pkt 13), edycja danych zachowywana między skanami (pkt 14), szyfrowanie at rest (pkt 16).
- **Moduł sygnatur**: **tylko bezpieczna detekcja**, bez eksploatacji i bez prób logowania.
- **Skanowanie**: wielowątkowe (nmap), pomiar czasu, adaptacyjny podział na podgrupy, okna czasowe i częstotliwość, przerwanie i wznowienie w kolejnym oknie, ograniczanie tempa.
- **Sekcja 3**: minimalny i „mile widziany” zakres. **Sekcja 6**: jak będzie testowane (co najmniej dwa przebiegi skanu, role, import, edycja). **Sekcja 8**: wagi kryteriów oceny.

## Zanim zaczniesz

- Zmieniasz kod, zmienne env albo komendy apki → najpierw przeczytaj jej `README.md`.
- Komendy per apka są w README. Poniżej są tylko komendy roota.

## Dokumentacja i tłumaczenia w tej samej zmianie

- Zmiana stacku, komend, zmiennych env albo struktury apki → zaktualizuj jej `README.md`.
- Zmiana konwencji, komend monorepo albo struktury repo → zaktualizuj ten plik.
- Gdy tworzysz **nowy** `README.md` albo plik w `docs/`, zapytaj użytkownika, czy dopisać go do tabeli „Gdzie szukać”.
- Każdy tekst widoczny w UI dodajesz **od razu po polsku i po angielsku** (`apps/frontend/src/lib/i18n/locales/{pl,en}`). Nie kopiuj angielskiego tekstu do pliku polskiego. `pnpm test` sprawdza tylko zgodność kluczy, nie jakość tłumaczenia.

## Gdzie szukać

| Temat | Źródło |
|---|---|
| Wymagania, kryteria oceny, ograniczenia | `hackathon-zadanie.pdf` (root repo) |
| Frontend (stack, struktura bulletproof-react, data fetching, i18n) | [`apps/frontend/README.md`](apps/frontend/README.md) |
| Backend (stack, moduły, Prisma, env, walidacja) | [`apps/backend/README.md`](apps/backend/README.md) |
| Workery C++ (konwencja, protokół HTTP pull, bezpieczeństwo skanu) | [`apps/workers/README.md`](apps/workers/README.md) |
| nmap-worker (build CMake/Docker, uprawnienia sieciowe) | [`apps/workers/nmap-worker/README.md`](apps/workers/nmap-worker/README.md) |
| Kontrakt (schematy zod, generowanie OpenAPI, dodawanie endpointu) | [`packages/contracts/README.md`](packages/contracts/README.md) |
| Typowany klient API (i dlaczego ma TS 6) | [`packages/api-client/README.md`](packages/api-client/README.md) |
| Lokalna infrastruktura (PostgreSQL, worker w compose) | [`docker/README.md`](docker/README.md) |
| Dokumentacja techniczna i prezentacja | [`docs/`](docs/) |

## Struktura repozytorium

Monorepo pnpm + turbo. Workspace'y to `apps/*` i `packages/*`.

- `apps/frontend`: React 19 + Vite 8 + React Router 8 (tryb data) + Tailwind 4 + shadcn/ui + TanStack Query.
- `apps/backend`: Express 5 + TS (build tsdown, dev tsx). Rozmawia z PostgreSQL przez Prisma 7. **Jedyny komponent, który pisze do bazy.**
- `apps/workers/<name>`: workery C++23 + CMake + nmap, budowane i uruchamiane w Dockerze. **Nie są workspace'em pnpm** (brak `package.json`), żeby `pnpm build` nie wymagał lokalnego kompilatora C++.
- `packages/contracts`: `@hacknation/contracts`, schematy zod i typy. Generuje commitowany `openapi.json`. Pakiet źródłowy, bez builda.
- `packages/api-client`: `@hacknation/api-client`, typy generowane z `openapi.json` + `openapi-fetch`. **Jedyny workspace z TypeScript 6** (`openapi-typescript` potrzebuje JS API, którego TS 7 nie ma).
- `docker/`: Docker Compose (PostgreSQL 19, worker pod profilem `workers`). Nie jest workspace'em.
- `docs/`: dokumentacja techniczna i prezentacja.

## Architektura (ustalona)

- **Kontrakt:** `contracts/*.schema.ts` (zod) → `pnpm generate` → `openapi.json` → `api-client` (typy) → frontend (`api.useQuery("get", "/path")`). Backend waliduje requesty tymi samymi schematami. Workery C++ biorą opis endpointów z tego samego `openapi.json`.
- **Workery ↔ backend:** HTTP pull. Worker pobiera porcję pracy (lease + heartbeat) i odsyła wyniki przez REST. Workery nie mają dostępu do bazy.
- **Auth/RBAC:** lokalne konta (argon2) i JWT w ciasteczku httpOnly. Cztery role z PDF (pkt 13). Jeszcze niezaimplementowane.
- **Dane wrażliwe:** szyfrowane at rest na poziomie aplikacji. Do zaprojektowania razem z modelami.

## Komendy monorepo

Tylko komendy roota. Komendy per apka są w ich README.

```bash
pnpm install        # zależności całego monorepo (+ prisma generate)
pnpm project:setup  # kopiuje każdy .env*.example do .env (nie nadpisuje; --force robi backup)
pnpm dev            # turbo dev: backend :3001 (+ /docs), frontend :3000
pnpm build          # turbo build
pnpm lint           # oxlint type-aware we wszystkich workspace'ach
pnpm check-types    # tsc (TS 7; api-client: TS 6)
pnpm test           # vitest
pnpm generate       # contracts -> openapi.json -> api-client/src/generated (commituj wynik)
pnpm clean
pnpm db:up          # PostgreSQL w Dockerze (pnpm db:logs)
pnpm db:reset       # drop + migracje + seed
pnpm infra:up       # wszystkie domyślne serwisy compose (infra:down, infra:logs)
pnpm workers:build  # build obrazów workerów (workers:up, workers:down, workers:logs)
```

## Konwencje

- **Po każdej zmianie w `packages/contracts` uruchom `pnpm generate`** i zacommituj `openapi.json` oraz `api-client/src/generated`. CI odrzuca nieaktualne pliki wygenerowane.
- Aliasy importów: `@/*` → `apps/frontend/src/*`, `~backend/*` → `apps/backend/src/*`.
- Każdy workspace ma własny `tsconfig.json` i `.oxlintrc.json` (ten drugi rozszerza root `.oxlintrc.json`). TS 6+ domyślnie ustawia `types: []`, więc `types` (np. `["node"]`, `["vite/client"]`) wpisuj jawnie.
- **Dodawanie zależności:** przed dodaniem paczki sprawdź jej najnowszą wersję na npm (`npm view <pkg> version`). Nigdy nie wpisuj wersji z pamięci. `pnpm-workspace.yaml` ma `minimumReleaseAge: 2880` (48 h). Jeśli najnowsza wersja jest młodsza, wpisz najnowszą, która ma już ponad 48 h. Nie wyłączaj tego zabezpieczenia.
- **Bezpieczeństwo skanera** (PDF, sekcja 2): tylko detekcja, bez eksploatacji i bez prób logowania. Tempo zawsze ograniczone. Skanujemy tylko dozwolone porty i zakresy. Po przekroczeniu okna czasowego skan się zatrzymuje.
- **Komentarze tylko dla rzeczy nieoczywistych i krótkie:**
  - Pisz je tylko dla ograniczenia, które zaskoczy następną osobę, dla odrzuconej oczywistej alternatywy albo dla czegoś, co wygląda na błąd, a nim nie jest.
  - Jedna linia albo kilka punktów, nigdy akapity.
  - Nie powtarzaj tego, co mówi nazwa albo typ. Bez docblocków na każdej funkcji.
  - Opis tego, jak moduł się składa, należy do `README.md` apki.
