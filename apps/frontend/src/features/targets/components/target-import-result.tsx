import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { ImportTargetsResponse } from "@subsurf/contracts/targets/targets.schema";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

interface TargetImportResultProps {
  result: ImportTargetsResponse;
  onImportMore: () => void;
}

export function TargetImportResult({ result, onImportMore }: TargetImportResultProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const { scan, warnings } = result;
  // These warnings already say why no scan was queued.
  const nothingToScan = warnings.some(
    (warning) => warning.code === "no_scannable_targets" || warning.code === "worker_not_registered",
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("targets.import.result.title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 text-sm">
        <ul className="grid gap-1">
          <li>{t("targets.import.result.created", { count: result.created })}</li>
          {result.skipped > 0 && (
            <li className="text-muted-foreground">
              {t("targets.import.result.skipped", { count: result.skipped })}
            </li>
          )}
        </ul>

        {scan ? (
          <section className="grid gap-2">
            <h2 className="font-medium">{t("targets.import.result.scanTitle")}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
              <dt className="text-muted-foreground">{t("targets.import.result.addresses")}</dt>
              <dd className="tabular-nums">{formatNumber(scan.addressCount, locale)}</dd>
              <dt className="text-muted-foreground">{t("targets.import.result.jobs")}</dt>
              <dd className="tabular-nums">{formatNumber(scan.jobCount, locale)}</dd>
              <dt className="text-muted-foreground">{t("targets.import.result.ports")}</dt>
              <dd className="font-mono break-words">{scan.ports.replaceAll(",", ", ")}</dd>
              <dt className="text-muted-foreground">{t("targets.import.result.maxRate")}</dt>
              <dd>{t("targets.import.result.maxRateValue", { rate: scan.maxRate })}</dd>
            </dl>
          </section>
        ) : (
          !nothingToScan && <p className="text-muted-foreground">{t("targets.import.result.noScan")}</p>
        )}

        {warnings.length > 0 && (
          <section className="grid gap-2">
            <h2 className="font-medium">{t("targets.import.result.warningsTitle")}</h2>
            <ul className="grid gap-1">
              {warnings.map((warning) => (
                <li key={`${warning.code}:${warning.value}`}>
                  {warning.value && <span className="font-mono">{warning.value}: </span>}
                  {t(`targets.import.warnings.${warning.code}`)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={onImportMore}>{t("targets.import.result.importMore")}</Button>
          <Button variant="outline" asChild>
            <Link to="/app/targets">{t("targets.import.result.toTargets")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
