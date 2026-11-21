# @hacknation/contracts

Jedno źródło prawdy o API: schematy **zod 4** i typy z nich wyprowadzone, a z nich generowany `openapi.json` (OpenAPI 3.1). Z tego pliku korzystają frontend (przez `@hacknation/api-client`), backend (walidacja requestów, Swagger) i workery C++ (opis endpointów).

Pakiet jest source-only. Nie ma kroku build, konsumenci kompilują go razem ze swoim kodem.

```
src/<feature>/<feature>.schema.ts    schematy + typy (bez importów OpenAPI, apki ich nie potrzebują)
src/<feature>/<feature>.openapi.ts   rejestracja ścieżek i komponentów (side effect)
src/common/common.schema.ts          wspólne prymitywy, ErrorResponse
scripts/                             registry, import-registries (posortowany import), generate-openapi
openapi.json                         WYGENEROWANY, commitowany
```

## Przepływ

```
*.schema.ts ──► *.openapi.ts ──► pnpm generate ──► openapi.json ──► api-client (typy) ──► frontend
     │                                                  └──────────► backend /docs, workery
     └──► backend validate() + typy kontrolerów
```

## Dodanie endpointu

1. W `src/<feature>/<feature>.schema.ts` dodaj schematy z konwencją nazw `XParamsSchema`, `XQuerySchema`, `XBodySchema`, `XResponseSchema` oraz typy `z.infer` na końcu pliku.
2. W `src/<feature>/<feature>.openapi.ts` dodaj `registry.registerPath({...})` z `operationId`. Chronione endpointy dostają `security: [{ bearerAuth: [] }]`.
3. Uruchom `pnpm generate` z roota. Regeneruje `openapi.json` i typy w `api-client`, w podanej kolejności.
4. Zacommituj wygenerowane pliki. CI sprawdza, czy są aktualne.

Import w apkach: `import { HealthResponseSchema } from "@hacknation/contracts/health/health.schema"`.

## Uwagi

- Kolejność rejestracji decyduje o kolejności w `openapi.json`. Dlatego `import-registries.ts` importuje pliki posortowane i po kolei, a każda regeneracja daje identyczny plik.
- Unikaj transformacji (`.trim()`, `.transform()`) w schematach requestów. Backend wywołuje `parse` bez przypisania wyniku, więc przetransformowana wartość nie dotrze do handlera.
