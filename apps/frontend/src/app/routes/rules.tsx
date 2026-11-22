import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/page-header";
import { RulesPanel } from "@/features/rules/components/rules-panel";

export function RulesRoute() {
  const { t } = useTranslation("rules");

  return (
    <div className="grid gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <RulesPanel />
    </div>
  );
}
