import { useTranslation } from "react-i18next";

import type { VulnerabilitySource } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSyncRuns } from "@/features/vulnerabilities/api/get-sync-runs";
import { useErrorMessage } from "@/hooks/use-error-message";
import { formatDateTime, formatNumber } from "@/lib/format";

export function SyncRunsDialog({
  source,
  onClose,
}: {
  source: VulnerabilitySource;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("vulnerabilities");
  const locale = i18n.resolvedLanguage;
  const errorMessage = useErrorMessage();
  const runs = useSyncRuns(source.id);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t("sources.runsTitle", { name: source.displayName })}</DialogTitle>
          <DialogDescription>{source.baseUrl}</DialogDescription>
        </DialogHeader>
        {runs.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : runs.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(runs.error)}
          </p>
        ) : runs.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("sources.runsEmpty")}</p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("sources.stats.started")}</TableHead>
                  <TableHead>{t("sources.stats.mode")}</TableHead>
                  <TableHead>{t("sources.stats.status")}</TableHead>
                  <TableHead className="text-right">{t("sources.stats.records")}</TableHead>
                  <TableHead className="text-right">{t("sources.stats.withdrawn")}</TableHead>
                  <TableHead className="text-right">{t("sources.stats.matches")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.data.items.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>{formatDateTime(run.startedAt, locale)}</TableCell>
                    <TableCell>
                      {t(`sources.modes.${run.mode}`)}
                      <span className="text-muted-foreground"> · {t(`sources.triggers.${run.trigger}`)}</span>
                    </TableCell>
                    <TableCell>
                      {t(`sources.statuses.${run.status}`)}
                      {run.error && (
                        <p className="max-w-64 text-xs whitespace-normal text-destructive">{run.error}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(run.stats.upserted, locale)} / {formatNumber(run.stats.unchanged, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(run.stats.withdrawn + run.stats.swept, locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {run.stats.matchesAdded} / {run.stats.matchesRetracted} / {run.stats.matchesReactivated}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
