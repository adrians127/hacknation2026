import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { ImportTargetsResponse } from "@hacknation/contracts/targets/targets.schema";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { TargetImportForm } from "@/features/targets/components/target-import-form";
import { TargetImportResult } from "@/features/targets/components/target-import-result";

export function TargetsNewRoute() {
  const { t } = useTranslation();
  const [result, setResult] = useState<ImportTargetsResponse | null>(null);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("targets.import.title")}
        description={t("targets.import.subtitle")}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/targets">
              <ArrowLeft />
              {t("targets.import.back")}
            </Link>
          </Button>
        }
      />
      {result ? (
        <TargetImportResult result={result} onImportMore={() => setResult(null)} />
      ) : (
        <TargetImportForm onImported={setResult} />
      )}
    </div>
  );
}
