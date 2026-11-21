import { createBrowserRouter } from "react-router";

import { guestLoader, requireAuthLoader } from "@/app/loaders";
import { RoleDetailRoute } from "@/app/routes/admin/role-detail";
import { RolesRoute } from "@/app/routes/admin/roles";
import { UsersRoute } from "@/app/routes/admin/users";
import { AppLayout } from "@/app/routes/app-layout";
import { ChangePasswordRoute } from "@/app/routes/change-password";
import { DashboardRoute } from "@/app/routes/dashboard";
import { LandingRoute } from "@/app/routes/landing";
import { LoginRoute } from "@/app/routes/login";
import { NotFoundRoute } from "@/app/routes/not-found";
import { RequirePermission } from "@/app/routes/require-permission";
import { RootLayout } from "@/app/routes/root-layout";
import { RouteError } from "@/app/routes/route-error";
import { ScansRoute } from "@/app/routes/scans";
import { StatusRoute } from "@/app/routes/status";
import { TargetsRoute } from "@/app/routes/targets";

/**
 * - `/` (landing), `/status` (API health) and `/login` are public; signed-in users are
 *   sent from `/login` to `/app`.
 * - The app sits under `/app`, in the protected layout whose loader loads `/auth/me`
 *   and enforces a pending password change.
 * - Pages that need a permission check it in `RequirePermission` (403 page, no redirect).
 *   The backend checks every permission again; this is only what the UI shows.
 */
export const router = createBrowserRouter([
  {
    Component: RootLayout,
    ErrorBoundary: RouteError,
    children: [
      { index: true, Component: LandingRoute },
      { path: "status", Component: StatusRoute },
      { path: "login", loader: guestLoader, Component: LoginRoute },
      {
        path: "app",
        loader: requireAuthLoader,
        Component: AppLayout,
        ErrorBoundary: RouteError,
        children: [
          { index: true, Component: DashboardRoute },
          { path: "change-password", Component: ChangePasswordRoute },
          {
            path: "targets",
            element: <RequirePermission permission="targets:read" />,
            children: [{ index: true, Component: TargetsRoute }],
          },
          {
            path: "scans",
            element: <RequirePermission permission="scans:read" />,
            children: [{ index: true, Component: ScansRoute }],
          },
          {
            path: "admin/users",
            element: <RequirePermission permission="users:read" />,
            children: [{ index: true, Component: UsersRoute }],
          },
          {
            path: "admin/roles",
            element: <RequirePermission permission="roles:read" />,
            children: [
              { index: true, Component: RolesRoute },
              { path: ":roleId", Component: RoleDetailRoute },
            ],
          },
          { path: "*", Component: NotFoundRoute },
        ],
      },
      { path: "*", Component: NotFoundRoute },
    ],
  },
]);
