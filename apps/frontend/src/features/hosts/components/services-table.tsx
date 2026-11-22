import { Pencil } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ScanHost, ScanService } from "@subsurf/contracts/scans/scan-results.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Checkbox } from "@/components/ui/checkbox";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { HttpSummary } from "@/features/hosts/components/http-summary";
import { RemediationDates } from "@/features/hosts/components/remediation-dates";
import { ServiceIdentity } from "@/features/hosts/components/service-identity";
import { TagList } from "@/features/hosts/components/tag-list";
import { TriageControl } from "@/features/hosts/components/triage-control";
import { VulnerabilitySummaryBadge } from "@/features/vulnerabilities/components/vulnerability-summary";
import { createDataTableColumns } from "@/lib/data-table";

const column = createDataTableColumns<ScanService>();

/** Selected hosts and services; a selected host stands for all of its services. */
export interface RowSelection {
  hostIds: ReadonlySet<string>;
  serviceIds: ReadonlySet<string>;
  toggleHost: (id: string) => void;
  toggleService: (id: string) => void;
}

/** The services of one host in one scan: shown under its row in the hosts table. */
export function ServicesTable({
  host,
  compared,
  onEdit,
  selection,
}: {
  host: ScanHost;
  compared: boolean;
  onEdit: (host: ScanHost, service: ScanService) => void;
  selection?: RowSelection;
}) {
  const { t } = useTranslation("hosts");
  const { t: tv } = useTranslation("vulnerabilities");
  const showChange = compared && host.services.some((service) => service.change && service.change !== "unchanged");
  const showHttp = host.services.some((service) => service.http.length > 0);
  const showTags = host.services.some((service) => service.tags.length > 0);
  const showRemediation = host.services.some((service) => service.remediation !== null);
  const showNote = host.services.some((service) => !!service.note);

  const columns = useMemo(
    () =>
      column.columns([
        ...(selection
          ? [
              column.display({
                id: "select",
                header: () => <span className="sr-only">{t("columns.select")}</span>,
                meta: { className: "w-8" },
                cell: ({ row: { original: service } }) =>
                  // A gone service is not part of this scan's results.
                  service.change === "gone" ? null : (
                    <Checkbox
                      checked={selection.hostIds.has(host.id) || selection.serviceIds.has(service.id)}
                      disabled={selection.hostIds.has(host.id)}
                      onCheckedChange={() => selection.toggleService(service.id)}
                      aria-label={t("actions.select", { name: `${host.ip}:${service.port}` })}
                    />
                  ),
              }),
            ]
          : []),
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
        ...(showChange
          ? [
              column.accessor("change", {
                header: t("columns.change"),
                enableSorting: false,
                meta: { className: "w-20" },
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
          meta: { className: "w-36" },
          cell: ({ getValue }) => <VulnerabilitySummaryBadge summary={getValue()} />,
        }),
        ...(showHttp
          ? [
              column.accessor("http", {
                header: t("columns.http"),
                enableSorting: false,
                cell: ({ getValue }) => <HttpSummary endpoints={getValue()} />,
              }),
            ]
          : []),
        column.accessor("triage", {
          header: t("columns.triage"),
          enableSorting: false,
          meta: { className: "w-40" },
          cell: ({ row: { original: service } }) => (
            <TriageControl
              target={{ hostId: host.id, serviceId: service.id }}
              value={service.triage}
              rule={service.triageRule}
              label={t("actions.triageOf", { name: `${host.ip}:${service.port}` })}
            />
          ),
        }),
        ...(showTags
          ? [
              column.accessor("tags", {
                header: t("columns.tags"),
                enableSorting: false,
                meta: { className: "w-20" },
                cell: ({ getValue }) => <TagList tags={getValue()} />,
              }),
            ]
          : []),
        ...(showRemediation
          ? [
              column.accessor("remediation", {
                header: t("columns.remediation"),
                enableSorting: false,
                meta: { className: "w-32" },
                cell: ({ getValue }) => <RemediationDates remediation={getValue()} />,
              }),
            ]
          : []),
        ...(showNote
          ? [
              column.accessor("note", {
                header: t("columns.note"),
                enableSorting: false,
                meta: { className: "w-20" },
                cell: ({ getValue }) => (
                  <span className="line-clamp-2 text-muted-foreground" title={getValue()}>
                    {getValue()}
                  </span>
                ),
              }),
            ]
          : []),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("columns.actions")}</span>,
          meta: { className: "w-12" },
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
    [t, tv, host, showChange, showHttp, showTags, showRemediation, showNote, onEdit, selection],
  );

  return (
    <div className="px-2 py-2 sm:pl-12">
      <DataTable
        columns={columns}
        data={host.services}
        emptyLabel={t("detail.noServices")}
        tableClassName="min-w-[880px] table-fixed [&>tbody>tr>td]:whitespace-normal [&>tbody>tr>td]:wrap-anywhere"
        rowClassName={(service) => (service.change === "gone" ? "opacity-60" : undefined)}
      />
    </div>
  );
}
