import { Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Target } from "@subsurf/contracts/targets/targets.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime, formatNumber } from "@/lib/format";

interface TargetsTableProps {
  targets: Target[];
  onEdit: (target: Target) => void;
  onDelete: (target: Target) => void;
  onFilterTag: (tag: string) => void;
}

const column = createDataTableColumns<Target>();

/** One page of the inventory. The server pages and orders it, so the columns do not sort. */
export function TargetsTable({ targets, onEdit, onDelete, onFilterTag }: TargetsTableProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("value", {
          header: t("targets.columns.value"),
          enableSorting: false,
          cell: ({ getValue }) => <span className="font-medium break-all">{getValue()}</span>,
        }),
        column.accessor("kind", {
          header: t("targets.columns.kind"),
          enableSorting: false,
          cell: ({ getValue }) => <Badge variant="outline">{t(`targets.kinds.${getValue()}`)}</Badge>,
        }),
        column.accessor("note", { header: t("targets.columns.note"), enableSorting: false }),
        column.accessor("tags", {
          header: t("targets.columns.tags"),
          enableSorting: false,
          cell: ({ getValue }) => (
            <span className="flex flex-wrap gap-1">
              {getValue().map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onFilterTag(tag)}
                  aria-label={t("targets.actions.filterByTag", { tag })}
                  className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <Badge variant="secondary" className="hover:bg-secondary/70">
                    {tag}
                  </Badge>
                </button>
              ))}
            </span>
          ),
        }),
        column.accessor("activeHosts", {
          header: t("targets.columns.activeHosts"),
          enableSorting: false,
          meta: { className: "text-right tabular-nums" },
          cell: ({ getValue }) => formatNumber(getValue(), locale),
        }),
        column.accessor("lastScanAt", {
          header: t("targets.columns.lastScan"),
          enableSorting: false,
          meta: { className: "text-muted-foreground" },
          cell: ({ row: { original: target } }) =>
            target.lastScanId && target.lastScanAt ? (
              <Link
                to={`/app/scans/${target.lastScanId}`}
                aria-label={t("targets.actions.openLastScan", { value: target.value })}
                className="hover:text-foreground hover:underline"
              >
                {formatDateTime(target.lastScanAt, locale)}
              </Link>
            ) : (
              t("targets.never")
            ),
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("targets.columns.actions")}</span>,
          cell: ({ row: { original: target } }) => (
            <div className="flex justify-end gap-1">
              <IconAction
                label={t("targets.actions.edit", { value: target.value })}
                icon={<Pencil />}
                permissions={["targets:update"]}
                onClick={() => onEdit(target)}
              />
              <IconAction
                label={t("targets.actions.delete", { value: target.value })}
                icon={<Trash2 />}
                permissions={["targets:delete"]}
                destructive
                onClick={() => onDelete(target)}
              />
            </div>
          ),
        }),
      ]),
    [t, locale, onEdit, onDelete, onFilterTag],
  );

  return <DataTable columns={columns} data={targets} />;
}
