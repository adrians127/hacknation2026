import { Outlet } from "react-router";

import { AppProvider } from "@/app/provider";

export function RootLayout() {
  return (
    <AppProvider>
      <Outlet />
    </AppProvider>
  );
}
