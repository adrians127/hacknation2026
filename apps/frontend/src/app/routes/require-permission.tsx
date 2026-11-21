import { useTranslation } from "react-i18next";
import { Link, Outlet } from "react-router";

import type { Permission } from "@subsurf/contracts/auth/permissions";

import { Button } from "@/components/ui/button";
import { usePermissionLabel } from "@/lib/auth/labels";
import { useCan } from "@/lib/auth/use-can";

/** Layout route: renders its children, or a "no access" page when the role lacks the permission. */
export function RequirePermission({ permission }: { permission: Permission }) {
  const allowed = useCan(permission);
  return allowed ? <Outlet /> : <ForbiddenPage permission={permission} />;
}

function ForbiddenPage({ permission }: { permission: Permission }) {
  const { t } = useTranslation();
  const permissionLabel = usePermissionLabel();

  return (
    <section className="flex flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-2xl font-semibold">{t("forbidden.title")}</h1>
      <p className="max-w-md text-muted-foreground">
        {t("forbidden.description", { permission: permissionLabel(permission) })}
      </p>
      <Button asChild variant="outline">
        <Link to="/app">{t("forbidden.back")}</Link>
      </Button>
    </section>
  );
}
