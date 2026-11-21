# apps/workers

Workery skanujące w **C++**. Jeden katalog to jeden worker: `apps/workers/<name>/` z własnym `CMakeLists.txt`, `CMakePresets.json`, `Dockerfile` i `README.md`.

Katalog **nie jest workspace'em pnpm** (nie ma `package.json`), więc turbo go pomija, a `pnpm build` nie wymaga lokalnego kompilatora C++. Workery budują się i działają w Dockerze (`pnpm workers:build`, `pnpm workers:up`), a CI kompiluje każdy obraz.

| Worker | Opis |
|---|---|
| [`nmap-worker`](nmap-worker/README.md) | Discovery hostów i usług przez nmap (na razie tylko szkielet) |

## Protokół z backendem: HTTP pull (ustalony, jeszcze niezaimplementowany)

Workery nie mają dostępu do bazy. Tylko backend do niej pisze (Prisma). Każdy worker:

1. **Lease**: pobiera z backendu porcję pracy (podgrupę adresów z celu skanu) razem z parametrami: porty, limity tempa, okno czasowe, timeout.
2. **Skan**: uruchamia nmap (`-oX -` → parsowanie XML) i ewentualnie fingerprinting HTTP. Pilnuje okna czasowego i przy jego przekroczeniu przerywa pracę.
3. **Wynik**: odsyła wyniki i metryki (czas trwania, liczba hostów) przez REST, a backend dzieli kolejne porcje adaptacyjnie na podstawie tych pomiarów.
4. **Heartbeat** przedłuża lease. Lease bez heartbeatu wygasa i porcja wraca do puli.

Endpointy workerów będą opisane w `packages/contracts` (tag `Workers`), razem z resztą API. Uwierzytelnienie workera (token maszynowy) zostanie ustalone razem z modułem auth.

## Bezpieczeństwo skanowania (wymóg z PDF)

Skan ma być **bezpieczny**: tylko detekcja, żadnej eksploatacji ani prób logowania. Tempo musi być ograniczone (`--max-rate`, `--scan-delay`, timing), skan może dotyczyć wyłącznie dozwolonych portów i zakresów z konfiguracji, a po przekroczeniu okna czasowego zostaje zatrzymany.
