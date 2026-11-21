# @hacknation/api-client

Typowany klient HTTP generowany z `@hacknation/contracts/openapi.json`. Typy `paths` / `components` generuje **openapi-typescript**, a w runtime działa **openapi-fetch** (cienka nakładka na `fetch`, ok. 6 kB).

```ts
import { createApiClient, type Schema } from "@hacknation/api-client";

const client = createApiClient("http://localhost:3001/v1", { credentials: "include" });
const { data, error } = await client.GET("/health");   // data: Schema<"HealthResponse">
```

Frontend opakowuje go w hooki TanStack Query przez `openapi-react-query` (`apps/frontend/src/api/client.ts`).

## Generowanie

```bash
pnpm generate     # z roota: najpierw contracts -> openapi.json, potem ten pakiet
```

`src/generated/openapi.d.ts` jest commitowany, a CI sprawdza, czy jest aktualny. Nie edytuj go ręcznie.

## Dlaczego tutaj jest TypeScript 6

Cała reszta repo używa TypeScript 7 (natywny `tsgo`). Pakiet `typescript@7` nie ma już klasycznego JS API (jego główny eksport to tylko `lib/version.cjs`), a `openapi-typescript` go potrzebuje (peer `typescript`). Dlatego **tylko ten workspace** ma `typescript@6.0.3` w devDependencies. pnpm rozwiązuje peer z tego pakietu, więc reszta repo zostaje na TS 7. `pnpm peers check` zgłasza ostrzeżenie (`openapi-typescript` deklaruje `^5.x`), ale generacja działa poprawnie. Gdy `openapi-typescript` zacznie wspierać TS 7, podbij wersję i usuń ten wyjątek.
