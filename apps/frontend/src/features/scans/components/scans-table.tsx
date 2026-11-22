import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { hasResults, scanDate } from "@/features/scans/lib/pair";
import { SCAN_STATUS_VARIANT } from "@/features/scans/lib/status";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";

const column = createDataTableColumns<Scan>();

/** Scans, with checkboxes to pick two of them (with results) for a comparison. */
export function ScansTable({
  scans,
  selected,
  onToggle,
}: {
  scans: Scan[];
  selected: ReadonlySet<string>;
  onToggle: (scan: Scan) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;

  const columns = useMemo(
    () =>
      column.columns([
        column.display({
          id: "select",
          header: () => <span className="sr-only">{t("scans.compare.open")}</span>,
          meta: { className: "w-10" },
          cell: ({ row: { original: scan } }) => (
            <Checkbox
              checked={selected.has(scan.id)}
              disabled={!hasResults(scan)}
              onCheckedChange={() => onToggle(scan)}
              aria-label={t("scans.compare.selectScan", {
                date: formatDateTime(scanDate(scan), locale),
              })}
            />
          ),
        }),
        column.accessor("createdAt", {
          header: t("scans.columns.started"),
          sortFn: "datetime",
          cell: ({ row: { original: scan } }) => (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link to={`/app/scans/${scan.id}`} className="font-medium hover:underline">
                {formatDateTime(scan.startedAt ?? scan.createdAt, locale)}
              </Link>
              {scan.name && <span className="text-muted-foreground">{scan.name}</span>}
            </span>
          ),
        }),
        column.accessor("status", {
          header: t("scans.columns.status"),
          cell: ({ getValue }) => (
            <Badge variant={SCAN_STATUS_VARIANT[getValue()]}>{t(`scans.statuses.${getValue()}`)}</Badge>
          ),
        }),
        column.accessor((scan) => scan.pipeline?.name ?? "", {
          id: "pipeline",
          header: t("scans.columns.pipeline"),
          cell: ({ row: { original: scan } }) => (
            <div className="grid">
              {scan.pipeline ? (
                <Link to={`/app/pipelines/${scan.pipeline.id}`} className="hover:underline">
                  {scan.pipeline.name}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              <span className="text-xs text-muted-foreground">{t(`scans.triggers.${scan.trigger}`)}</span>
            </div>
          ),
        }),
        column.accessor("addressCount", {
          header: t("scans.columns.addresses"),
          meta: { className: "text-right tabular-nums" },
          cell: ({ getValue }) => formatNumber(getValue(), locale),
        }),
        column.accessor((scan) => scan.hosts.up, {
          id: "up",
          header: t("scans.columns.up"),
          meta: { className: "text-right tabular-nums" },
          cell: ({ getValue }) => formatNumber(getValue(), locale),
        }),
        column.accessor((scan) => scan.hosts.timeout + scan.hosts.cancelled + scan.hosts.failed, {
          id: "noAnswer",
          header: t("scans.columns.noAnswer"),
          meta: { className: "text-right tabular-nums" },
          cell: ({ getValue }) => formatNumber(getValue(), locale),
        }),
        column.accessor("openPorts", {
          header: t("scans.columns.openPorts"),
          meta: { className: "text-right tabular-nums" },
          cell: ({ getValue }) => formatNumber(getValue(), locale),
        }),
        column.accessor("durationMs", {
          header: t("scans.columns.duration"),
          meta: { className: "tabular-nums" },
          cell: ({ getValue }) => {
            const ms = getValue();
            return ms === null ? "—" : formatDuration(Math.round(ms / 1000));
          },
        }),
      ]),
    [t, locale, selected, onToggle],
  );

  return <DataTable columns={columns} data={scans} />;
}
