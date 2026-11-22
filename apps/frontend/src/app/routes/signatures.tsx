import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/page-header";
import { SignaturesPanel } from "@/features/signatures/components/signatures-panel";

export function SignaturesRoute() {
  const { t } = useTranslation("signatures");

  return (
    <div className="grid gap-6">
      <PageHeader title={t("title")} description={t("description")} />
      <SignaturesPanel />
    </div>
  );
}
