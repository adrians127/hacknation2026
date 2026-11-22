import { useTranslation } from "react-i18next";

import type { HostHistoryEntry } from "@subsurf/contracts/scans/scan-results.schema";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const DOT_CLASS: Record<HostHistoryEntry["status"], string> = {
  up: "border-emerald-500 bg-emerald-500",
  down: "border-red-500 bg-red-500",
  timeout: "border-muted-foreground border-dashed bg-transparent",
  cancelled: "border-muted-foreground border-dashed bg-transparent",
  failed: "border-muted-foreground border-dashed bg-transparent",
};

/**
 * The address's answers in its latest scans, oldest on the left, with the compared scans marked
 * A and B. Picking a dot compares with that scan.
 */
export function HostTimeline({
  history,
  baseScanId,
  targetScanId,
  onPick,
}: {
  /** Newest first, as the API returns it. */
  history: readonly HostHistoryEntry[];
  baseScanId?: string | null;
  targetScanId: string;
  onPick?: (entry: HostHistoryEntry) => void;
}) {
  const { t, i18n } = useTranslation("hosts");
  const locale = i18n.resolvedLanguage;

  return (
    <section className="grid gap-2">
      <h4 className="text-sm font-medium">{t("timeline.title")}</h4>
      <ol className="flex flex-wrap items-end gap-3">
        {history.toReversed().map((entry) => {
          const mark =
            entry.scanId === targetScanId
              ? t("timeline.target")
              : entry.scanId === baseScanId
                ? t("timeline.base")
                : null;
          const label = t("timeline.dot", {
            date: formatDateTime(entry.scannedAt, locale),
            status: t(`observation.${entry.status}`),
            ports: entry.openPorts,
          });
          // aria-disabled, not disabled: a disabled button would not show its tooltip.
          const pickable = onPick !== undefined && entry.scanId !== targetScanId;
          return (
            <li key={entry.scanId} className="grid justify-items-center gap-1">
              <span className="h-4 text-xs font-semibold text-brand">{mark}</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={label}
                    aria-current={entry.scanId === targetScanId ? "true" : undefined}
                    aria-disabled={!pickable}
                    onClick={() => pickable && onPick(entry)}
                    className={cn(
                      "size-4 rounded-full border-2 transition-transform",
                      pickable ? "hover:scale-125" : "cursor-default",
                      DOT_CLASS[entry.status],
                      mark && "ring-2 ring-brand ring-offset-2 ring-offset-background",
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ol>
      {onPick && <p className="text-xs text-muted-foreground">{t("timeline.hint")}</p>}
    </section>
  );
}
