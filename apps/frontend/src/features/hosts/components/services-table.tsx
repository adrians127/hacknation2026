import { Pencil } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ScanHost, ScanService } from "@subsurf/contracts/scans/scan-results.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { HttpSummary } from "@/features/hosts/components/http-summary";
import { ServiceIdentity } from "@/features/hosts/components/service-identity";
import { TagList } from "@/features/hosts/components/tag-list";
import { TriageControl } from "@/features/hosts/components/triage-control";
import { VulnerabilitySummaryBadge } from "@/features/vulnerabilities/components/vulnerability-summary";
import { createDataTableColumns } from "@/lib/data-table";

const column = createDataTableColumns<ScanService>();

/** The services of one host in one scan: shown under its row in the hosts table. */
export function ServicesTable({
  host,
  compared,
  onEdit,
}: {
  host: ScanHost;
  compared: boolean;
  onEdit: (host: ScanHost, service: ScanService) => void;
}) {
  const { t } = useTranslation("hosts");
  const { t: tv } = useTranslation("vulnerabilities");

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
        ...(compared
          ? [
              column.accessor("change", {
                header: t("columns.change"),
                enableSorting: false,
                cell: ({ getValue }) => <ChangeBadge change={getValue()} />,
              }),
            ]
          : []),
        column.display({
          id: "service",
          header: t("columns.service"),
          cell: ({ row: { original: service } }) => <ServiceIdentity service={service} />,
        }),
        column.accessor("vulnerabilities", {
          header: tv("columns.vulnerabilities"),
          enableSorting: false,
          cell: ({ getValue }) => <VulnerabilitySummaryBadge summary={getValue()} />,
        }),
        column.accessor("http", {
          header: t("columns.http"),
          enableSorting: false,
          meta: { className: "max-w-96" },
          cell: ({ getValue }) => <HttpSummary endpoints={getValue()} />,
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
    [t, tv, host, compared, onEdit],
  );

  return (
    <div className="px-2 py-2 sm:pl-12">
      <DataTable
        columns={columns}
        data={host.services}
        emptyLabel={t("detail.noServices")}
        rowClassName={(service) => (service.change === "gone" ? "opacity-60" : undefined)}
      />
    </div>
  );
}
