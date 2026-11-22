import {
  Bug,
  Cpu,
  Crosshair,
  FileText,
  Fingerprint,
  LayoutDashboard,
  Radar,
  ShieldCheck,
  Users,
  WandSparkles,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Outlet } from "react-router";

import type { Permission } from "@subsurf/contracts/auth/permissions";

import { Logo } from "@/components/logo";
import { AccountPanel } from "@/features/auth/components/account-panel";
import { usePermissions } from "@/lib/auth/use-can";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label:
    | "nav.dashboard"
    | "nav.targets"
    | "nav.scans"
    | "nav.reports"
    | "nav.rules"
    | "nav.signatures"
    | "nav.pipelines"
    | "nav.workers"
    | "nav.vulnerabilities"
    | "nav.users"
    | "nav.roles";
  Icon: LucideIcon;
  permission?: Permission;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: "/app", label: "nav.dashboard", Icon: LayoutDashboard },
  { to: "/app/targets", label: "nav.targets", Icon: Crosshair, permission: "targets:read" },
  { to: "/app/scans", label: "nav.scans", Icon: Radar, permission: "scans:read" },
  { to: "/app/reports", label: "nav.reports", Icon: FileText, permission: "scans:read" },
  { to: "/app/rules", label: "nav.rules", Icon: WandSparkles, permission: "rules:read" },
  { to: "/app/signatures", label: "nav.signatures", Icon: Fingerprint, permission: "signatures:read" },
  { to: "/app/pipelines", label: "nav.pipelines", Icon: Workflow, permission: "pipelines:read" },
  { to: "/app/admin/workers", label: "nav.workers", Icon: Cpu, permission: "workers:read" },
  {
    to: "/app/admin/vulnerabilities",
    label: "nav.vulnerabilities",
    Icon: Bug,
    permission: "vulnerabilities:read",
  },
  { to: "/app/admin/users", label: "nav.users", Icon: Users, permission: "users:read" },
  { to: "/app/admin/roles", label: "nav.roles", Icon: ShieldCheck, permission: "roles:read" },
];

export function AppLayout() {
  const { t } = useTranslation();
  const held = usePermissions();
  // Sections the role cannot open are not shown at all; opening one by URL shows a 403 page.
  const items = NAV_ITEMS.filter((item) => !item.permission || held.has(item.permission));

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="print:hidden flex shrink-0 flex-col gap-6 border-b p-4 md:sticky md:top-0 md:h-svh md:w-60 md:border-r md:border-b-0">
        <Link to="/" className="w-fit">
          <Logo variant="icon" label={t("appName")} className="w-14" />
        </Link>
        <nav aria-label={t("nav.label")} className="flex flex-wrap gap-1 md:flex-col">
          {items.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/app"}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm md:-ml-3 text-muted-foreground transition-colors hover:text-foreground",
                  isActive && "bg-brand/15 text-brand hover:text-brand",
                )
              }
            >
              <Icon className="size-4" />
              {t(label)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <AccountPanel />
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-8 print:p-0">
        <div className="mx-auto max-w-6xl print:max-w-none">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
