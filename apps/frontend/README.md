# @hacknation/frontend

Interfejs dla zespołu bezpieczeństwa: dashboard ze znaleziskami, cele, skany, diffy, sygnatury i administracja rolami.

## Stack

- **React 19** + **Vite 8** + **TypeScript 7**
- **React Router 8** w trybie data (`createBrowserRouter` w `src/app/router.tsx`)
- **TanStack Query 5** + **openapi-react-query**: hooki generowane z typowanego klienta `@hacknation/api-client`
- **Tailwind 4** (plugin Vite, bez pliku konfiguracyjnego) + **shadcn/ui** (styl `radix-nova`, `components.json`)
- **i18next**: PL (domyślny) + EN
- **Vitest** · **oxlint** (type-aware, reguły react / jsx-a11y)

## Komendy

```bash
pnpm --filter @hacknation/frontend dev       # :3000
pnpm --filter @hacknation/frontend build     # vite build -> dist/
pnpm --filter @hacknation/frontend test      # vitest (m.in. parzystość kluczy pl/en)
pnpm --filter @hacknation/frontend exec shadcn add <component>
```

## Struktura `src/` (bulletproof-react)

```
main.tsx                 bootstrap: i18n, App, CSS
app/                     app.tsx (RouterProvider), router.tsx, provider.tsx, routes/
api/                     client.ts (apiClient + hooki `api`), query-client.ts
components/ui/           wygenerowane przez shadcn (wyłączone z lintu)
config/                  typowane zmienne env (fail-fast)
features/<name>/         components/, hooks/, lib/, types/ (bez barrel files)
hooks/ lib/ stores/ types/   kod współdzielony
lib/i18n/                index.ts, locales/{pl,en}/*.json, test parzystości
```

Kierunek importów to shared → features → app. Kod współdzielony nie może importować z `features/` ani `app/`, a feature nie może importować z `app/`. Pilnuje tego oxlint (`no-restricted-imports` w `.oxlintrc.json`).

## Pobieranie danych

Typy i ścieżki pochodzą z `openapi.json`, więc błędny path, parametr albo pole odpowiedzi wychodzi przy kompilacji:

```tsx
import { api } from "@/api/client";

const health = api.useQuery("get", "/health");
const create = api.useMutation("post", "/targets");   // gdy endpoint powstanie
```

Klucze zapytań powstają z metody, ścieżki i parametrów, więc nie trzeba prowadzić osobnego rejestru kluczy. Do formularzy można użyć schematów zod z `@hacknation/contracts`, tych samych co walidacja w backendzie.

## Tłumaczenia

Każdy tekst widoczny dla użytkownika trafia do **obu** plików (`locales/pl/*.json` i `locales/en/*.json`) w tej samej zmianie. `t()` jest typowane względem polskich zasobów. `pnpm test` sprawdza, że klucze się zgadzają (z uwzględnieniem form mnogich: pl `one/few/many/other`, en `one/other`), ale nie sprawdzi, czy polski tekst jest faktycznie tłumaczeniem.

## Zmienne środowiskowe

| Zmienna | Opis |
|---|---|
| `VITE_API_BASE_URL` | URL backendu bez `/v1`, np. `http://localhost:3001` |
