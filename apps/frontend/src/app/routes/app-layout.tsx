import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router";

import type { Permission } from "@hacknation/contracts/auth/permissions";

import { LanguageToggle } from "@/components/language-toggle";
import { Logo } from "@/components/logo";
import { UserMenu } from "@/features/auth/components/user-menu";
import { usePermissions } from "@/lib/auth/use-can";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { to: string; label: "nav.dashboard" | "nav.users" | "nav.roles"; permission?: Permission }[] = [
  { to: "/", label: "nav.dashboard" },
  { to: "/admin/users", label: "nav.users", permission: "users:read" },
  { to: "/admin/roles", label: "nav.roles", permission: "roles:read" },
];

export function AppLayout() {
  const { t } = useTranslation();
  const held = usePermissions();
  // Sections the role cannot open are not shown at all; opening one by URL shows a 403 page.
  const items = NAV_ITEMS.filter((item) => !item.permission || held.has(item.permission));

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-semibold">
            <Logo variant="icon" label="" className="h-8 w-auto" />
            <span>{t("appName")}</span>
          </NavLink>
          <nav aria-label={t("nav.label")} className="flex flex-1 flex-wrap gap-1">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                    isActive && "bg-muted font-medium text-foreground",
                  )
                }
              >
                {t(item.label)}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
