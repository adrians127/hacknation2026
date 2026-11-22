import { useTranslation } from "react-i18next";

import type { ScanDetail } from "@subsurf/contracts/scans/scan-results.schema";

import { scanDate } from "@/features/scans/lib/pair";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Metric {
  key: "addresses" | "up" | "down" | "noAnswer" | "openPorts" | "duration";
  value: (scan: ScanDetail) => number | null;
}

const METRICS: Metric[] = [
  { key: "addresses", value: (scan) => scan.addressCount },
  { key: "up", value: (scan) => scan.hosts.up },
  { key: "down", value: (scan) => scan.hosts.down },
  { key: "noAnswer", value: (scan) => scan.hosts.timeout + scan.hosts.cancelled + scan.hosts.failed },
  { key: "openPorts", value: (scan) => scan.openPorts },
  { key: "duration", value: (scan) => (scan.durationMs === null ? null : Math.round(scan.durationMs / 1000)) },
];

/** The two scans' totals next to each other, with the difference, and what both covered. */
export function ScanPairStats({ base, target }: { base: ScanDetail; target: ScanDetail }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const show = (metric: Metric, value: number | null) =>
    value === null ? "—" : metric.key === "duration" ? formatDuration(value) : formatNumber(value, locale);

  return (
    <div className="grid gap-3">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 text-left font-normal">{t("scans.compare.metric")}</th>
            <th className="py-1.5 text-right font-normal">
              {t("scans.compare.columns.base", { date: formatDateTime(scanDate(base), locale) })}
            </th>
            <th className="py-1.5 text-right font-normal">
              {t("scans.compare.columns.target", { date: formatDateTime(scanDate(target), locale) })}
            </th>
            <th className="py-1.5 text-right font-normal">{t("scans.compare.delta")}</th>
          </tr>
        </thead>
        <tbody>
          {METRICS.map((metric) => {
            const before = metric.value(base);
            const after = metric.value(target);
            const delta = before === null || after === null ? null : after - before;
            return (
              <tr key={metric.key} className="border-b last:border-0">
                <th scope="row" className="py-1.5 text-left font-normal text-muted-foreground">
                  {t(`scans.compare.stats.${metric.key}`)}
                </th>
                <td className="py-1.5 text-right tabular-nums">{show(metric, before)}</td>
                <td className="py-1.5 text-right font-medium tabular-nums">{show(metric, after)}</td>
                <td
                  className={cn(
                    "py-1.5 text-right tabular-nums",
                    delta === null || delta === 0 ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {delta === null || delta === 0
                    ? "—"
                    : `${delta > 0 ? "+" : "−"}${show(metric, Math.abs(delta))}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {target.coverage && (
        <p className="text-xs text-muted-foreground">
          {t("scans.compare.coverage", {
            both: formatNumber(target.coverage.both, locale),
            onlyBase: formatNumber(target.coverage.onlyBase, locale),
            onlyCurrent: formatNumber(target.coverage.onlyCurrent, locale),
          })}
        </p>
      )}
    </div>
  );
}
