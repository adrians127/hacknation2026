import { createBrowserRouter } from "react-router";

import { guestLoader, requireAuthLoader } from "@/app/loaders";
import { AppLayout } from "@/app/routes/app-layout";
import { ChangePasswordRoute } from "@/app/routes/change-password";
import { HomeRoute } from "@/app/routes/home";
import { LoginRoute } from "@/app/routes/login";
import { NotFoundRoute } from "@/app/routes/not-found";
import { RootLayout } from "@/app/routes/root-layout";
import { RouteError } from "@/app/routes/route-error";

/**
 * - `/login` is public (signed-in users are redirected away).
 * - Everything else sits under the protected layout, whose loader loads `/auth/me`
 *   and enforces a pending password change.
 */
export const router = createBrowserRouter([
  {
    Component: RootLayout,
    ErrorBoundary: RouteError,
    children: [
      { path: "login", loader: guestLoader, Component: LoginRoute },
      {
        loader: requireAuthLoader,
        Component: AppLayout,
        ErrorBoundary: RouteError,
        children: [
          { index: true, Component: HomeRoute },
          { path: "change-password", Component: ChangePasswordRoute },
          { path: "*", Component: NotFoundRoute },
        ],
      },
    ],
  },
]);
