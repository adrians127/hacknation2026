import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { WorkerManager } from "@subsurf/contracts/workers/worker-registry.schema";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime } from "@/lib/format";

const column = createDataTableColumns<WorkerManager>();

export function ManagersTable({ managers }: { managers: WorkerManager[] }) {
  const { t, i18n } = useTranslation("pipelines");
  const locale = i18n.resolvedLanguage;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("managerId", {
          header: t("workers.managers.columns.manager"),
          cell: ({ row: { original: manager } }) => (
            <div className="flex flex-wrap items-center gap-2">
              <code className="font-medium">{manager.managerId}</code>
              <Badge variant={manager.isOnline ? "default" : "outline"}>
                {t(manager.isOnline ? "workers.managers.online" : "workers.managers.offline")}
              </Badge>
            </div>
          ),
        }),
        column.accessor("version", { header: t("workers.managers.columns.version") }),
        column.display({
          id: "workers",
          header: t("workers.managers.columns.workers"),
          cell: ({ row: { original: manager } }) => (
            <div className="flex flex-wrap gap-1">
              {manager.workers.map((name) => (
                <Badge key={name} variant="secondary">
                  {name}
                </Badge>
              ))}
            </div>
          ),
        }),
        column.accessor("maxParallel", {
          header: t("workers.managers.columns.maxParallel"),
          meta: { className: "text-right tabular-nums" },
        }),
        column.accessor("lastSeenAt", {
          header: t("workers.managers.columns.lastSeen"),
          sortFn: "datetime",
          meta: { className: "text-muted-foreground" },
          cell: ({ getValue }) => formatDateTime(getValue(), locale),
        }),
      ]),
    [t, locale],
  );

  return <DataTable columns={columns} data={managers} />;
}
