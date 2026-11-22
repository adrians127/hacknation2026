import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { ImportScanResponse } from "@subsurf/contracts/scans/scan-import.schema";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ScanImportForm } from "@/features/scans/components/scan-import-form";
import { ScanImportResult } from "@/features/scans/components/scan-import-result";

export function ScanImportRoute() {
  const { t } = useTranslation();
  const [result, setResult] = useState<ImportScanResponse | null>(null);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("scans.import.title")}
        description={t("scans.import.subtitle")}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/scans">
              <ArrowLeft />
              {t("scans.detail.back")}
            </Link>
          </Button>
        }
      />
      {result ? (
        <ScanImportResult result={result} onImportMore={() => setResult(null)} />
      ) : (
        <ScanImportForm onImported={setResult} />
      )}
    </div>
  );
}
