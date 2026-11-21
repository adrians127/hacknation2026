import { Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Target } from "@hacknation/contracts/targets/targets.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime } from "@/lib/format";

interface TargetsTableProps {
  targets: Target[];
  onEdit: (target: Target) => void;
  onDelete: (target: Target) => void;
}

const column = createDataTableColumns<Target>();

export function TargetsTable({ targets, onEdit, onDelete }: TargetsTableProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("value", {
          header: t("targets.columns.value"),
          cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>,
        }),
        column.accessor("kind", {
          header: t("targets.columns.kind"),
          cell: ({ getValue }) => <Badge variant="outline">{t(`targets.kinds.${getValue()}`)}</Badge>,
        }),
        column.accessor("note", { header: t("targets.columns.note"), enableSorting: false }),
        column.accessor("tags", {
          header: t("targets.columns.tags"),
          enableSorting: false,
          cell: ({ getValue }) => (
            <span className="flex flex-wrap gap-1">
              {getValue().map((tag) => (
                <Badge key={tag} variant="secondary">
                  {tag}
                </Badge>
              ))}
            </span>
          ),
        }),
        column.accessor("activeHosts", {
          header: t("targets.columns.activeHosts"),
          meta: { className: "text-right tabular-nums" },
        }),
        column.accessor("lastScanAt", {
          header: t("targets.columns.lastScan"),
          sortFn: "datetime",
          meta: { className: "text-muted-foreground" },
          cell: ({ getValue }) => {
            const value = getValue();
            return value ? formatDateTime(value, locale) : t("targets.never");
          },
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
    [t, locale, onEdit, onDelete],
  );

  return <DataTable columns={columns} data={targets} />;
}
