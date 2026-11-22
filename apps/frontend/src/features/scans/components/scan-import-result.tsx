import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { ImportScanResponse } from "@subsurf/contracts/scans/scan-import.schema";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";

interface ScanImportResultProps {
  result: ImportScanResponse;
  onImportMore: () => void;
}

export function ScanImportResult({ result, onImportMore }: ScanImportResultProps) {
  const { t, i18n } = useTranslation();
  const { hosts, edits } = result;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("scans.import.result.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 text-sm">
        <ul className="grid gap-1">
          <li>
            {t("scans.import.result.hosts", {
              up: hosts.up,
              down: hosts.down,
              noAnswer: hosts.timeout + hosts.cancelled + hosts.failed,
              ports: result.openPorts,
            })}
          </li>
          <li className="text-muted-foreground">
            {t("scans.import.result.placed", {
              date: formatDateTime(result.placedAt, i18n.resolvedLanguage),
            })}
          </li>
          {edits && <li>{t("scans.import.result.edits", edits)}</li>}
          {result.warningCount > 0 && (
            <li className="text-muted-foreground">
              {t("scans.import.result.warnings", { count: result.warningCount })}
            </li>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={`/app/scans/${result.scanId}`}>{t("scans.import.result.open")}</Link>
          </Button>
          <Button variant="outline" onClick={onImportMore}>
            {t("scans.import.result.another")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
