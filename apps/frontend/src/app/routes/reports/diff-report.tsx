import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import { Skeleton } from "@/components/ui/skeleton";
import { DiffReportView } from "@/features/reports/components/diff-report";
import { useScans } from "@/features/scans/api/get-scans";
import { useErrorMessage } from "@/hooks/use-error-message";

/** `/app/reports/diff?from=&to=`; without both, the two latest scans with results. */
export function DiffReportRoute() {
  const [params, setParams] = useSearchParams();
  const scans = useScans();
  const errorMessage = useErrorMessage();
  const { t } = useTranslation("reports");
  const withResults = (scans.data?.items ?? []).filter((scan) =>
    Object.values(scan.hosts).some((count) => count > 0),
  );
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const [newest, previous] = withResults;

  useEffect(() => {
    if ((from && to) || !newest || !previous) return;
    setParams({ from: previous.id, to: newest.id }, { replace: true });
  }, [from, to, newest, previous, setParams]);

  if (scans.isPending) return <Skeleton className="h-96 w-full" />;
  if (scans.isError) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(scans.error)}
      </p>
    );
  }
  if (withResults.length < 2) return <p className="text-muted-foreground">{t("stability.needScans")}</p>;
  return (
    <DiffReportView
      scans={withResults}
      from={from}
      to={to}
      onChange={(next) => setParams({ from: next.from, to: next.to }, { replace: true })}
    />
  );
}
