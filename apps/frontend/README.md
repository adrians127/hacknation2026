# @hacknation/frontend

The interface for the security team: a dashboard with findings, targets, scans, diffs, signatures and role administration.

## Stack

- **React 19** + **Vite 8** + **TypeScript 7**
- **React Router 8** in data mode (`createBrowserRouter` in `src/app/router.tsx`)
- **TanStack Query 5** + **openapi-react-query**: hooks generated from the typed `@hacknation/api-client`
- **Tailwind 4** (Vite plugin, no config file) + **shadcn/ui** (`radix-nova` style, `components.json`)
- **i18next**: EN (default) + PL
- **Vitest** · **oxlint** (type-aware, react / jsx-a11y rules)

## Commands

```bash
pnpm --filter @hacknation/frontend dev       # :3000
pnpm --filter @hacknation/frontend build     # vite build -> dist/
pnpm --filter @hacknation/frontend test      # vitest (incl. en/pl key parity)
pnpm --filter @hacknation/frontend exec shadcn add <component>
```

## `src/` structure (bulletproof-react)

```
main.tsx                 bootstrap: i18n, App, CSS
app/                     app.tsx (RouterProvider), router.tsx, provider.tsx, routes/
api/                     client.ts (apiClient + `api` hooks + session refresh), query-client.ts, mock.ts (mock helpers)
components/              shared components: guarded-button, icon-action, confirm-dialog, language-toggle, logo
components/ui/           shadcn components (excluded from lint)
config/                  typed env variables (fail-fast)
features/<name>/         api/, components/, hooks/, lib/, types/ (no barrel files)
hooks/ lib/ stores/ types/   shared code
lib/auth/                useMe, useCan/usePermissions, role and permission labels, safe redirects
lib/i18n/                index.ts, locales/{en,pl}/{common,auth,admin}.json, parity test
```

Imports flow shared → features → app. Shared code must not import from `features/` or `app/`, and a feature must not import from `app/`. oxlint enforces this (`no-restricted-imports` in `.oxlintrc.json`).

## Data fetching

Types and paths come from `openapi.json`, so a wrong path, parameter or response field fails at compile time:

```tsx
import { api } from "@/api/client";

const health = api.useQuery("get", "/health");
const create = api.useMutation("post", "/targets");   // once the endpoint exists
```

Query keys are built from the method, path and parameters, so there is no separate key registry to maintain. Forms can use the zod schemas from `@hacknation/contracts`, the same ones the backend validates with.

A feature's data goes through hooks in `features/<name>/api/`, one file per endpoint (`get-targets.ts` → `useTargets`, `create-target.ts` → `useCreateTarget`). Components call those hooks, never `api.*` directly. A one-off call outside a feature, such as `/health` on the home route, may use `api.useQuery` directly.

## Mocking endpoints the backend doesn't have yet

The frontend moves faster than the backend, so features start on mocked data. A mock lives **only in the feature's `api/` hooks**, behind TanStack Query. Components see the same `useQuery`/`useMutation` result (loading, error, cache, invalidation) they will see against the real backend. Switching an endpoint to the backend then changes one function in one file.

Rules:

- **Mock only in `features/<name>/api/`.** Components and routes import the hooks, never `mocks.ts` or `@/api/mock`.
- **Types come from contracts.** First write the zod schema and `z.infer` type in `packages/contracts/src/<feature>/<feature>.schema.ts` (step 1 of [adding an endpoint](../../packages/contracts/README.md#adding-an-endpoint)). The path doesn't need to be registered yet. If the shape isn't settled, a temporary type in `features/<name>/types/` is fine, marked `// MOCK:`.
- **Use the same query keys as openapi-react-query**: `["get", "/targets"]`, or `["get", "/targets/{id}", { params: { path: { id } } }]` with parameters. Invalidations you write now keep working after the swap.
- **Mutations take `{ body, params }`**, like `api.useMutation`, so the `mutate(...)` calls in components don't change.
- **Fixtures live in `features/<name>/api/mocks.ts`** as in-memory data. Mocked mutations modify that data, so lists refresh after invalidation as they will with the backend. A page reload resets it.
- **Mark every mock with `// MOCK: <target api call>`.** `grep -rn "MOCK:" apps/frontend/src` lists what is still left to integrate.
- `mockResponse(data)` and `mockError(status, message)` from `@/api/mock` add a short delay, return a copy of the fixture and reject with the same `ErrorResponse` body as a real non-2xx response.

A mocked query and a mocked mutation:

```ts
// features/targets/api/get-targets.ts
import type { TargetListResponse } from "@hacknation/contracts/targets/targets.schema";
import { queryOptions, useQuery } from "@tanstack/react-query";

import { mockResponse } from "@/api/mock";
import { mockTargets } from "@/features/targets/api/mocks";

// MOCK: api.queryOptions("get", "/targets")
export const targetsQueryOptions = () =>
  queryOptions({
    queryKey: ["get", "/targets"] as const,
    queryFn: (): Promise<TargetListResponse> => mockResponse(mockTargets.list()),
  });

export const useTargets = () => useQuery(targetsQueryOptions());
```

```ts
// features/targets/api/create-target.ts
// MOCK: api.useMutation("post", "/targets", { onSuccess })
export function useCreateTarget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body }: { body: CreateTargetBody }) => mockResponse(mockTargets.add(body)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/targets"] }),
  });
}
```

Once the backend ships the endpoint, only the function body changes:

```ts
export const targetsQueryOptions = () => api.queryOptions("get", "/targets");

export function useCreateTarget() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/targets", {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["get", "/targets"] }),
  });
}
```

Swap checklist:

1. The endpoint is registered in contracts and `pnpm generate` has run.
2. Replace the mocked `queryFn`/`mutationFn` with `api.*`. Keep the hook's name and signature.
3. Delete the fixture from `mocks.ts` (and the file once it's empty) and the `// MOCK:` line.
4. `pnpm check-types` shows any place where the mock's shape differed from the backend's.

## Auth and permissions

Sign-in, sessions and RBAC are enforced by the backend ([backend README](../backend/README.md#auth-and-rbac)). The frontend only decides what to show.

- **Session:** two httpOnly cookies the frontend never reads. `api/client.ts` has an openapi-fetch middleware: on a 401 (except from `/auth/login|refresh|logout`) it calls `POST /auth/refresh` once, shared by parallel requests, and retries the request. If the refresh fails, the handler registered in `app/provider.tsx` clears the cache and sends the user to `/login?redirectTo=…`.
- **Routes** (`app/router.tsx`): the landing page `/` and `/login` are public (`guestLoader` sends signed-in users to `/app`). The app sits under `/app`, in the protected layout whose `requireAuthLoader` loads `/auth/me`, redirects to `/login` on a 401 and to `/app/change-password` while `mustChangePassword` is set. `redirectTo` only accepts same-app paths (`lib/auth/safe-redirect.ts`).
- **Current user:** `useMe()` (`lib/auth/me-query.ts`) inside the protected layout; the loader guarantees the data. Update the `/auth/me` cache yourself when a mutation changes what a loader reads (see `features/auth/api/change-password.ts`).
- **Permissions in the UI:**
  - `useCan("users:create")` / `usePermissions()` from `lib/auth/use-can.ts`.
  - Navigation hides sections the role cannot open (`app/routes/app-layout.tsx`).
  - Opening such a page by URL shows a no-access page: wrap the route in `<RequirePermission permission="…" />` (`app/routes/require-permission.tsx`).
  - Actions stay visible but blocked: `GuardedButton` / `IconAction` take `permissions={[…]}` and an optional `disabledReason`. They use `aria-disabled` rather than `disabled`, so the button keeps focus and hover and the tooltip can name the missing permission.
- **Labels:** system roles are translated by key and custom roles show their stored name (`useRoleLabels`); permissions read as "Resource: Action" (`usePermissionLabel`, keys in `auth.json`). A new permission needs `permissions.resources.<resource>` (and a new action) in both languages.
- **Errors:** `useErrorMessage()` turns anything a query or mutation threw into a translated message, by the API's `error.code` (`common.json`, `errors.*`) or by status.
- **Admin panel:** `features/users` and `features/roles` (the permission matrix in `features/roles/lib/permission-matrix.ts` is built from the contracts catalog). The admin routes compose them, e.g. the user form gets the role list from `features/roles`.

## Translations

English is the default language: the fallback for unsupported browser languages and the reference for typing. Every user-facing string goes into **both** files (`locales/en/*.json` and `locales/pl/*.json`) in the same change. `t()` is typed against the English resources. `pnpm test` checks that the keys match (including plural forms: en `one/other`, pl `one/few/many/other`), but it cannot check whether the Polish text is an actual translation.

## Environment variables

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Backend URL without `/v1`, e.g. `http://localhost:3001` |
