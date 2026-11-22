import { Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Worker } from "@subsurf/contracts/workers/worker-registry.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { createDataTableColumns } from "@/lib/data-table";
import { formatNumber } from "@/lib/format";

const column = createDataTableColumns<Worker>();

export function WorkersTable({
  workers,
  onEdit,
  onDelete,
}: {
  workers: Worker[];
  onEdit: (worker: Worker) => void;
  onDelete: (worker: Worker) => void;
}) {
  const { t, i18n } = useTranslation("pipelines");
  const locale = i18n.resolvedLanguage;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("displayName", {
          header: t("workers.columns.name"),
          cell: ({ row: { original: worker } }) => (
            <div className="grid gap-0.5">
              <span className="font-medium">{worker.displayName}</span>
              {worker.displayName !== worker.name && (
                <code className="text-xs text-muted-foreground">{worker.name}</code>
              )}
            </div>
          ),
        }),
        column.accessor("description", {
          header: t("workers.columns.description"),
          cell: ({ getValue }) => <p className="max-w-md text-sm text-muted-foreground">{getValue()}</p>,
        }),
        column.accessor("maxRate", {
          header: t("workers.columns.maxRate"),
          meta: { className: "text-right tabular-nums" },
          cell: ({ getValue }) => t("workers.perSecond", { value: formatNumber(getValue(), locale) }),
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("workers.columns.actions")}</span>,
          meta: { className: "text-right" },
          cell: ({ row: { original: worker } }) => (
            <div className="flex justify-end gap-1">
              <IconAction
                label={t("workers.actions.edit")}
                icon={<Pencil />}
                permissions={["workers:update"]}
                onClick={() => onEdit(worker)}
              />
              <IconAction
                label={t("workers.actions.delete")}
                icon={<Trash2 />}
                permissions={["workers:delete"]}
                destructive
                onClick={() => onDelete(worker)}
              />
            </div>
          ),
        }),
      ]),
    [t, locale, onEdit, onDelete],
  );

  return <DataTable columns={columns} data={workers} />;
}
