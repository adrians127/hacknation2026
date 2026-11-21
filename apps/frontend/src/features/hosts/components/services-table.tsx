import { Pencil } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { HostListItem, ServiceSummary } from "@subsurf/contracts/hosts/hosts.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { HttpSummary } from "@/features/hosts/components/http-summary";
import { ServiceIdentity } from "@/features/hosts/components/service-identity";
import { TagList } from "@/features/hosts/components/tag-list";
import { TriageControl } from "@/features/hosts/components/triage-control";
import { createDataTableColumns } from "@/lib/data-table";

const column = createDataTableColumns<ServiceSummary>();

/** The services of one host: shown under its row in the hosts table. */
export function ServicesTable({
  host,
  onEdit,
}: {
  host: HostListItem;
  onEdit: (host: HostListItem, service: ServiceSummary) => void;
}) {
  const { t } = useTranslation("hosts");

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("port", {
          header: t("columns.port"),
          enableSorting: false,
          meta: { className: "w-24" },
          cell: ({ row: { original: service } }) => (
            <span className="font-mono">
              {service.port}/{service.protocol}
            </span>
          ),
        }),
        column.display({
          id: "service",
          header: t("columns.service"),
          cell: ({ row: { original: service } }) => <ServiceIdentity service={service} />,
        }),
        column.accessor("http", {
          header: t("columns.http"),
          enableSorting: false,
          meta: { className: "max-w-80" },
          cell: ({ getValue }) => <HttpSummary endpoints={getValue()} />,
        }),
        column.accessor("seenInLatestScan", {
          header: t("columns.latestScan"),
          enableSorting: false,
          cell: ({ getValue }) =>
            getValue() ? (
              <Badge variant="outline" className="border-emerald-500/40 text-emerald-500">
                {t("service.open")}
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                {t("service.notSeen")}
              </Badge>
            ),
        }),
        column.accessor("triage", {
          header: t("columns.triage"),
          enableSorting: false,
          cell: ({ row: { original: service } }) => (
            <TriageControl
              target={{ hostId: host.id, serviceId: service.id }}
              value={service.triage}
              label={t("actions.triageOf", { name: `${host.ip}:${service.port}` })}
            />
          ),
        }),
        column.accessor("tags", {
          header: t("columns.tags"),
          enableSorting: false,
          cell: ({ getValue }) => <TagList tags={getValue()} />,
        }),
        column.accessor("note", {
          header: t("columns.note"),
          enableSorting: false,
          meta: { className: "max-w-48" },
          cell: ({ getValue }) => (
            <span className="line-clamp-2 text-muted-foreground" title={getValue()}>
              {getValue()}
            </span>
          ),
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("columns.actions")}</span>,
          cell: ({ row: { original: service } }) => (
            <div className="flex justify-end">
              <IconAction
                label={t("actions.editService", { name: `${host.ip}:${service.port}` })}
                icon={<Pencil />}
                permissions={["hosts:update"]}
                onClick={() => onEdit(host, service)}
              />
            </div>
          ),
        }),
      ]),
    [t, host, onEdit],
  );

  return (
    <div className="px-2 py-2 sm:pl-12">
      <DataTable
        columns={columns}
        data={host.services}
        emptyLabel={t("detail.noServices")}
        rowClassName={(service) => (service.seenInLatestScan ? undefined : "opacity-60")}
      />
    </div>
  );
}
