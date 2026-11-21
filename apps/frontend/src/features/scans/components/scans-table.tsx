import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { SCAN_STATUS_VARIANT } from "@/features/scans/lib/status";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime, formatDuration, formatNumber } from "@/lib/format";

const column = createDataTableColumns<Scan>();

export function ScansTable({ scans }: { scans: Scan[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("createdAt", {
          header: t("scans.columns.started"),
          sortFn: "datetime",
          cell: ({ row: { original: scan } }) => (
            <Link to={`/app/scans/${scan.id}`} className="font-medium hover:underline">
              {formatDateTime(scan.startedAt ?? scan.createdAt, locale)}
            </Link>
          ),
        }),
        column.accessor("status", {
          header: t("scans.columns.status"),
          cell: ({ getValue }) => (
            <Badge variant={SCAN_STATUS_VARIANT[getValue()]}>{t(`scans.statuses.${getValue()}`)}</Badge>
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
    [t, locale],
  );

  return <DataTable columns={columns} data={scans} />;
}
