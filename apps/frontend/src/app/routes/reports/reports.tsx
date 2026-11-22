import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/page-header";
import { ReportsHub } from "@/features/reports/components/reports-hub";

export function ReportsRoute() {
  const { t } = useTranslation("reports");
  return (
    <div className="grid gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ReportsHub />
    </div>
  );
}
