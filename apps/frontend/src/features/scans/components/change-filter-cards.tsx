import { useTranslation } from "react-i18next";

import type { ScanChangeCounts, ScanChangeFilter } from "@subsurf/contracts/scans/scan-results.schema";

import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHANGE_TONE: Record<Exclude<ScanChangeFilter, "any">, string> = {
  new: "text-emerald-500",
  gone: "text-red-500",
  changed: "text-amber-500",
  unknown: "text-muted-foreground",
};

/** Host change counts as toggle buttons that filter the host list, and the service counts. */
export function ChangeFilterCards({
  changes,
  activeChange,
  onChangeFilter,
}: {
  changes: ScanChangeCounts;
  activeChange: ScanChangeFilter | undefined;
  onChangeFilter: (change: ScanChangeFilter | undefined) => void;
}) {
  const { t, i18n } = useTranslation();
  const number = (value: number) => formatNumber(value, i18n.resolvedLanguage);

  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["new", "gone", "changed", "unknown"] as const).map((change) => {
          const active = activeChange === change;
          return (
            <button
              key={change}
              type="button"
              aria-pressed={active}
              onClick={() => onChangeFilter(active ? undefined : change)}
              className={cn(
                "grid gap-0.5 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                active && "border-brand bg-brand/10",
              )}
            >
              <span className={cn("text-xl font-semibold tabular-nums", CHANGE_TONE[change])}>
                {number(changes.hosts[change])}
              </span>
              <span className="text-xs text-muted-foreground">{t(`scans.detail.hosts.${change}`)}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("scans.detail.serviceChanges", {
          new: number(changes.services.new),
          gone: number(changes.services.gone),
          changed: number(changes.services.changed),
        })}
      </p>
    </>
  );
}
