import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime, formatDuration } from "@/lib/format";

const STATUS_VARIANT = {
  queued: "outline",
  running: "default",
  completed: "secondary",
  stopped: "outline",
  failed: "destructive",
} as const;

const column = createDataTableColumns<Scan>();

export function ScansTable({ scans }: { scans: Scan[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("id", {
          header: t("scans.columns.id"),
          enableSorting: false,
          cell: ({ getValue }) => <span className="font-mono text-xs">{getValue().slice(0, 8)}</span>,
        }),
        column.accessor("status", {
          header: t("scans.columns.status"),
          cell: ({ getValue }) => (
            <Badge variant={STATUS_VARIANT[getValue()]}>{t(`scans.statuses.${getValue()}`)}</Badge>
          ),
        }),
        column.accessor("targetCount", {
          header: t("scans.columns.targets"),
          meta: { className: "text-right tabular-nums" },
        }),
        column.accessor("hostsFound", {
          header: t("scans.columns.hosts"),
          meta: { className: "text-right tabular-nums" },
        }),
        column.accessor("servicesFound", {
          header: t("scans.columns.services"),
          meta: { className: "text-right tabular-nums" },
        }),
        column.accessor("startedAt", {
          header: t("scans.columns.started"),
          sortFn: "datetime",
          cell: ({ getValue }) => formatDateTime(getValue(), locale),
        }),
        column.accessor("durationSeconds", {
          header: t("scans.columns.duration"),
          meta: { className: "tabular-nums" },
          cell: ({ getValue }) => {
            const seconds = getValue();
            return seconds === null ? "—" : formatDuration(seconds);
          },
        }),
      ]),
    [t, locale],
  );

  return <DataTable columns={columns} data={scans} />;
}
