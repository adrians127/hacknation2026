# @subsurf/frontend

The interface for the security team: a dashboard with findings, targets, scans, diffs, signatures and role administration.

## Stack

- **React 19** + **Vite 8** + **TypeScript 7**
- **React Router 8** in data mode (`createBrowserRouter` in `src/app/router.tsx`)
- **TanStack Query 5** + **openapi-react-query**: hooks generated from the typed `@subsurf/api-client`
- **TanStack Table 9**: sortable data tables (`components/data-table.tsx`)
- **Tailwind 4** (Vite plugin, no config file) + **shadcn/ui** (`radix-nova` style, `components.json`)
- **i18next**: EN (default) + PL
- **Vitest** · **oxlint** (type-aware, react / jsx-a11y rules)

## Commands

```bash
pnpm --filter @subsurf/frontend dev       # :3000
pnpm --filter @subsurf/frontend build     # vite build -> dist/
pnpm --filter @subsurf/frontend test      # vitest (incl. en/pl key parity)
pnpm --filter @subsurf/frontend exec shadcn add <component>
```

## `src/` structure (bulletproof-react)

```
main.tsx                 bootstrap: i18n, App, CSS
app/                     app.tsx (RouterProvider), router.tsx, provider.tsx, routes/
api/                     client.ts (apiClient + `api` hooks + session refresh), query-client.ts, mock.ts (mock helpers)
components/              shared components: data-table, page-header, guarded-button, icon-action, confirm-dialog, file-input, language-toggle, logo
components/ui/           shadcn components (excluded from lint)
config/                  typed env variables (fail-fast)
features/<name>/         api/, components/, hooks/, lib/, types/ (no barrel files)
hooks/ lib/ stores/ types/   shared code
lib/auth/                useMe, useCan/usePermissions, role and permission labels, safe redirects
lib/i18n/                index.ts, locales/{en,pl}/{common,auth,admin,hosts,vulnerabilities,reports}.json, parity test
```

Outside `src/`, `public/` is served as-is; `public/samples/targets.{csv,json}` and `scan-results.{csv,json}` are the sample files linked from the target and results import pages (`features/scans/lib/samples.test.ts` keeps the result samples importable).

Imports flow shared → features → app. Shared code must not import from `features/` or `app/`, and a feature must not import from `app/`. oxlint enforces this (`no-restricted-imports` in `.oxlintrc.json`).

## Data fetching

Types and paths come from `openapi.json`, so a wrong path, parameter or response field fails at compile time:

```tsx
import { api } from "@/api/client";

const health = api.useQuery("get", "/health");
const create = api.useMutation("post", "/targets");   // once the endpoint exists
```

Query keys are built from the method, path and parameters, so there is no separate key registry to maintain. Forms can use the zod schemas from `@subsurf/contracts`, the same ones the backend validates with.

A feature's data goes through hooks in `features/<name>/api/`, one file per endpoint (`get-targets.ts` → `useTargets`, `import-targets.ts` → `useImportTargets`). Components call those hooks, never `api.*` directly. A one-off call outside a feature, such as `/health` on the public `/status` page, may use `api.useQuery` directly.

## Mocking endpoints the backend doesn't have yet

The frontend moves faster than the backend, so features start on mocked data. A mock lives **only in the feature's `api/` hooks**, behind TanStack Query. Components see the same `useQuery`/`useMutation` result (loading, error, cache, invalidation) they will see against the real backend. Switching an endpoint to the backend then changes one function in one file.

Rules:

- **Mock only in `features/<name>/api/`.** Components and routes import the hooks, never `mocks.ts` or `@/api/mock`.
- **Types come from contracts.** First write the zod schema and `z.infer` type in `packages/contracts/src/<feature>/<feature>.schema.ts` (step 1 of [adding an endpoint](../../packages/contracts/README.md#adding-an-endpoint)). The path doesn't need to be registered yet. If the shape isn't settled, a temporary type in `features/<name>/types/` is fine, marked `// MOCK:`.
- **Use the same query keys as openapi-react-query**: `["get", "/targets"]`, or `["get", "/targets/{id}", { params: { path: { id } } }]` with parameters. Invalidations you write now keep working after the swap.
- **Mutations take `{ body, params }`**, like `api.useMutation`, so the `mutate(...)` calls in components don't change.
- **Fixtures live in `features/<name>/api/mocks.ts`** as in-memory data. Mocked mutations modify that data, so lists refresh after invalidation as they will with the backend. A page reload resets it.
- **Mark every mock with `// MOCK: <target api call>`.** `grep -rn "MOCK:" apps/frontend/src` lists what is still left to integrate.
- **Mark the page too:** a route whose data still comes from mocks passes `mocked` to `PageHeader`, which shows a "Mock data" badge next to the title, so nobody mistakes sample data for scan results.
- `mockResponse(data)` and `mockError(status, message, code?)` from `@/api/mock` add a short delay, return a copy of the fixture and reject with the same `ErrorResponse` body as a real non-2xx response (with `code`, the UI shows the translated `errors.<code>` message).

A mocked query and a mocked mutation:

```ts
// features/targets/api/get-targets.ts
import type { TargetListResponse } from "@subsurf/contracts/targets/targets.schema";
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
3. Delete the fixture from `mocks.ts` (and the file once it's empty) and the `// MOCK:` line. Once a page has no mocked data left, drop `mocked` from its `PageHeader`.
4. `pnpm check-types` shows any place where the mock's shape differed from the backend's.

## Auth and permissions

Sign-in, sessions and RBAC are enforced by the backend ([backend README](../backend/README.md#auth-and-rbac)). The frontend only decides what to show.

- **Session:** two httpOnly cookies the frontend never reads. `api/client.ts` has an openapi-fetch middleware: on a 401 (except from `/auth/login|refresh|logout`) it calls `POST /auth/refresh` once, shared by parallel requests, and retries the request. If the refresh fails, the handler registered in `app/provider.tsx` clears the cache and sends the user to `/login?redirectTo=…`.
- **Routes** (`app/router.tsx`): the landing page `/`, `/status` (API health) and `/login` are public (`guestLoader` sends signed-in users to `/app`). The app sits under `/app`, in the protected layout whose `requireAuthLoader` loads `/auth/me`, redirects to `/login` on a 401 and to `/app/change-password` while `mustChangePassword` is set. `redirectTo` only accepts same-app paths (`lib/auth/safe-redirect.ts`).
- **Current user:** `useMe()` (`lib/auth/me-query.ts`) inside the protected layout; the loader guarantees the data. Update the `/auth/me` cache yourself when a mutation changes what a loader reads (see `features/auth/api/change-password.ts`).
- **Permissions in the UI:**
  - `useCan("users:create")` / `usePermissions()` from `lib/auth/use-can.ts`.
  - Navigation hides sections the role cannot open (`app/routes/app-layout.tsx`).
  - Opening such a page by URL shows a no-access page: wrap the route in `<RequirePermission permission="…" />` (`app/routes/require-permission.tsx`).
  - Actions stay visible but blocked: `GuardedButton` / `IconAction` take `permissions={[…]}` and an optional `disabledReason`. They use `aria-disabled` rather than `disabled`, so the button keeps focus and hover and the tooltip can name the missing permission.
- **Labels:** system roles are translated by key and custom roles show their stored name (`useRoleLabels`); permissions read as "Resource: Action" (`usePermissionLabel`, keys in `auth.json`). A new permission needs `permissions.resources.<resource>` (and a new action) in both languages.
- **Errors:** `useErrorMessage()` turns anything a query or mutation threw into a translated message, by the API's `error.code` (`common.json`, `errors.*`) or by status.
- **Admin panel:** `features/users` and `features/roles` (the permission matrix in `features/roles/lib/permission-matrix.ts` is built from the contracts catalog). The admin routes compose them, e.g. the user form gets the role list from `features/roles`.
- **Pipelines and workers:** `features/pipelines` is the block builder (`/app/pipelines`, `/app/pipelines/new`, `/app/pipelines/:pipelineId`): targets (tags and ranges), an ordered chain of worker steps whose own settings are rendered from the worker's `paramFields` (`features/workers/components/worker-param-input.tsx`), and the schedule with a "Next runs" preview computed by the backend. The form is checked with the contracts' `PipelineBodySchema` and `validateStepParams`; without `pipelines:update` it is read-only, without `scans:run` the schedule controls are. `start-scan-dialog.tsx` is the scans page's "Start scan". `features/workers` is the Workers page (`app/routes/admin/workers.tsx`: the registry and the worker managers, refreshed every 30 s). The scan detail's Jobs tab (`features/scans/components/scan-jobs-panel.tsx`) shows each step's progress and the jobs; scan queries refresh every 5 s while a scan is queued, running or paused.
- **Vulnerabilities:** `features/vulnerabilities` holds the badges and the per-service list that `features/hosts` shows (the data comes with the scan's host responses, under `scans:read`), and the panels of the Vulnerability databases page (`app/routes/admin/vulnerabilities.tsx`: sources, sync history, CPE → package mappings). The sources query polls while a sync runs or waits for the sync process.

## Pages and tables

- A page starts with `PageHeader` (title, description, page-level buttons in `actions`) and puts its content in `Card`s.
- Lists use `DataTable` (`components/data-table.tsx`), a sortable table on TanStack Table v9. Define columns with `createDataTableColumns<T>().columns([...])` from `lib/data-table.ts`, inside `useMemo`: v9 rebuilds the table whenever `columns` or `data` change identity. `meta: { className }` styles a column's header and cells (e.g. `text-right`). Dates and numbers go through `lib/format.ts`.
  - `renderExpanded(row)` adds a full-width row under a row (return `null` while it is collapsed); the scan's host table uses it for each host's services.
  - Lists the server pages (`page`, `pageSize`, `total` in the response) put `DataTablePagination` under the table and disable column sorting (`enableSorting: false`), since sorting one page would mislead.
  - Filters, the page number and an open side panel live in the URL (`useSearchParams`), so a filtered view can be reloaded and shared (see `app/routes/scan-detail.tsx`).
- **Comparing scans** (`app/routes/scan-compare.tsx`, `/app/scans/compare?base=&target=`): scan A is always the older one (`orderPair` in `features/scans/lib/pair.ts` puts a pair given the wrong way round in order, so links can pass either order); without parameters B is the newest scan with results and A its base scan. Hosts come from `GET /scans/{target}/hosts?base=` and the side-by-side panel from `GET /scans/{target}/hosts/{id}?base=`, with each port's `before` and `fieldChanges`. Entry points: the scan list's checkboxes, "Compare side by side" on a scan and on its host panel, and the host timeline (`HostTimeline`), whose dots switch the compared scan.
- **Export and import of a scan** (`features/scans`): the scan page's "Export CSV" / "Export JSON" buttons download `GET /scans/{id}/export` as a blob. `/app/scans/import` (`scans:create`, `app/routes/scan-import.tsx`) reads the chosen file in the browser with the reader the API uses (`@subsurf/contracts/scans/scan-import`) and shows what the import adds, or why the file cannot be imported, before anything is sent. The file itself is then uploaded (`bodySerializer` returns the text as it is), not the parsed result. A file imported before links to the scan it became (`error.details.scanId`).
- **Dashboard** (`features/dashboard`, `GET /dashboard`): stat tiles for the newest scan (hosts up and open ports with the change since the previous scan and a per-scan trend from `GET /scans`; new and gone hosts and service changes link into the comparison) and the most important changes, each opening in the comparison. The trend line is a native range input over an SVG, so the pointer and the arrow keys both step through the scans.
- A list whose rows hold inputs (the target entry form's list) uses the `Table` primitives with keys from the data instead of `DataTable`: `DataTable` rebuilds when `data` changes, which would remount an input while someone types in it.
- A page with unsaved input the user built up (the target entry form) asks before leaving: `useLeaveGuard` in `features/targets/hooks/` (`useBlocker` + `beforeunload`).
- Details that do not fit a row open in a `Sheet` (`components/ui/sheet.tsx`, a side panel on the Radix dialog). It was written by hand: `shadcn add sheet` also tried to add an unrelated npm package.
- The app is dark-only (`class="dark"` in `index.html`); `brand` is the accent color (`text-brand`, `bg-brand/15`).

## Reports

`features/reports` renders the backend's `/reports/*` endpoints ([backend README](../backend/README.md#reports)) under `/app/reports` (`scans:read`). The hub (`/app/reports`) picks a scan, two scans or an IP address; the scan page links to its summary report and the host panel to the host's IP report.

- **Routes:** `scans/:scanId/:kind` (`summary`, `findings`, `technologies`, `exposure`, `triage`, `tags`), `diff?from=&to=`, `ips/:ip`, `stability?window=&inactiveAfter=`, `time-of-day?scans=`. Options live in the URL, so a report can be shared and reloaded.
- **`ReportShell`** (`components/report-parts.tsx`) gives every report its header, the generated-at line and three actions: **Print / PDF** (`window.print()`), **JSON** (the API response as is) and **CSV** (one flat table per report, built in the report's component).
- **Print:** the `@media print` block in `index.css` switches the dark tokens to light ones; the sidebar, controls and buttons carry `print:hidden`. `ReportTable` shows the first rows on screen with a toggle, but every row on paper.
- **CSV** (`lib/export.ts`): UTF-8 with a BOM for Excel, and cells starting with `=`, `+`, `-` or `@` are prefixed with `'` so a spreadsheet does not run them as formulas.

## Translations

English is the default language: the fallback for unsupported browser languages and the reference for typing. Every user-facing string goes into **both** files (`locales/en/*.json` and `locales/pl/*.json`) in the same change. `t()` is typed against the English resources. `pnpm test` checks that the keys match (including plural forms: en `one/other`, pl `one/few/many/other`), but it cannot check whether the Polish text is an actual translation.

## Environment variables

| Variable | Description |
|---|---|
| `VITE_API_BASE_URL` | Backend URL without `/v1`, e.g. `http://localhost:3001`; `/` = the page's own origin (the Docker image, whose nginx proxies `/v1` to the backend) |

## Docker

`apps/frontend/Dockerfile` (built from the repo root; `Dockerfile.dockerignore` replaces the root `.dockerignore`) builds the app with `VITE_API_BASE_URL=/` and serves it with nginx (`nginx.conf`), which proxies `/v1` to the `backend` container. One origin means cookies, CORS and the backend's Origin check work under any host name or IP. Compose runs it as `frontend` in the `app` profile ([`docker/README.md`](../../docker/README.md#everything-in-docker)).
