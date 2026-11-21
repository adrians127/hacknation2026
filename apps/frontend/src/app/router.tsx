import { createBrowserRouter } from "react-router";

import { HomeRoute } from "@/app/routes/home";
import { NotFoundRoute } from "@/app/routes/not-found";
import { RootLayout } from "@/app/routes/root-layout";

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    children: [
      { index: true, Component: HomeRoute },
      { path: "*", Component: NotFoundRoute },
    ],
  },
]);
