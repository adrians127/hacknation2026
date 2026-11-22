import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/page-header";
import { DashboardView } from "@/features/dashboard/components/dashboard-view";

export function DashboardRoute() {
  const { t } = useTranslation();

  return (
    <div className="grid gap-6">
      <PageHeader title={t("dashboard.title")} description={t("dashboard.subtitle")} />
      <DashboardView />
    </div>
  );
}
