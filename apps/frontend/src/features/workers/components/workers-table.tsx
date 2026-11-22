import { Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Worker } from "@subsurf/contracts/workers/worker-registry.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
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
          header: t("workers.columns.worker"),
          cell: ({ row: { original: worker } }) => (
            <div className="grid gap-0.5">
              <div className="flex flex-wrap items-center gap-2 font-medium">
                {worker.displayName}
                <code className="text-xs text-muted-foreground">{worker.name}</code>
                <Badge variant="outline">{t(worker.isBuiltin ? "workers.builtin" : "workers.custom")}</Badge>
              </div>
              {worker.description && (
                <p className="max-w-md text-sm text-muted-foreground">{worker.description}</p>
              )}
            </div>
          ),
        }),
        column.accessor("stage", {
          header: t("workers.columns.stage"),
          meta: { className: "text-right tabular-nums" },
        }),
        column.display({
          id: "takes",
          header: t("workers.columns.takes"),
          cell: ({ row: { original: worker } }) => (
            <div className="flex flex-wrap gap-1">
              {worker.inputs.map((input) => (
                <Badge key={input} variant="secondary">
                  {t(`workers.inputs.${input}`)}
                </Badge>
              ))}
            </div>
          ),
        }),
        column.accessor("maxRate", {
          header: t("workers.columns.maxRate"),
          meta: { className: "text-right tabular-nums" },
          cell: ({ getValue }) => t("workers.perSecond", { value: formatNumber(getValue(), locale) }),
        }),
        column.accessor("onlineManagers", {
          header: t("workers.columns.managers"),
          meta: { className: "text-right tabular-nums" },
        }),
        column.accessor("enabled", {
          header: t("workers.columns.status"),
          cell: ({ getValue }) => (
            <Badge variant={getValue() ? "secondary" : "outline"}>
              {t(getValue() ? "workers.enabled" : "workers.disabled")}
            </Badge>
          ),
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
              {!worker.isBuiltin && (
                <IconAction
                  label={t("workers.actions.delete")}
                  icon={<Trash2 />}
                  permissions={["workers:delete"]}
                  destructive
                  onClick={() => onDelete(worker)}
                />
              )}
            </div>
          ),
        }),
      ]),
    [t, locale, onEdit, onDelete],
  );

  return <DataTable columns={columns} data={workers} />;
}
