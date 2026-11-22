import { Columns2, Play } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { GuardedButton } from "@/components/guarded-button";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DefectDojoSyncCard } from "@/features/defectdojo/components/defectdojo-sync-card";
import { StartScanDialog } from "@/features/pipelines/components/start-scan-dialog";
import { useScans } from "@/features/scans/api/get-scans";
import { ScansTable } from "@/features/scans/components/scans-table";
import { compareUrl, orderPair } from "@/features/scans/lib/pair";
import { useErrorMessage } from "@/hooks/use-error-message";

export function ScansRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const scans = useScans();
  // At most two: picking a third drops the one picked first.
  const [selected, setSelected] = useState<readonly string[]>([]);
  const toggle = useCallback(
    (scan: Scan) =>
      setSelected((previous) =>
        previous.includes(scan.id)
          ? previous.filter((id) => id !== scan.id)
          : [...previous, scan.id].slice(-2),
      ),
    [],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const [isStarting, setIsStarting] = useState(false);

  const compare = () => {
    const [first, second] = selected;
    if (first && second && scans.data) {
      const [base, target] = orderPair(scans.data.items, first, second);
      void navigate(compareUrl({ base, target }));
    } else {
      void navigate("/app/scans/compare");
    }
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("scans.title")}
        description={t("scans.subtitle")}
        actions={
          <>
            <span className="self-center text-sm text-muted-foreground" aria-live="polite">
              {selected.length > 0 && t("scans.compare.selected", { count: selected.length })}
            </span>
            <Button variant="outline" onClick={compare}>
              <Columns2 />
              {t("scans.compare.open")}
            </Button>
            {/* A scan runs a pipeline; the dialog also links to the target import. */}
            <GuardedButton permissions={["scans:run"]} onClick={() => setIsStarting(true)}>
              <Play />
              {t("scans.start")}
            </GuardedButton>
          </>
        }
      />

      <DefectDojoSyncCard />

      {scans.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : scans.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(scans.error)}
        </p>
      ) : (
        <Card>
          <CardContent>
            <ScansTable scans={scans.data.items} selected={selectedSet} onToggle={toggle} />
          </CardContent>
        </Card>
      )}

      {isStarting && <StartScanDialog onClose={() => setIsStarting(false)} />}
    </div>
  );
}
