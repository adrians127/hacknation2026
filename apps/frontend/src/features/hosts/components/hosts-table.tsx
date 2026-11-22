import { ChevronDown, ChevronRight, PanelRightOpen, Pencil, StickyNote } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ScanHost, ScanService } from "@subsurf/contracts/scans/scan-results.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { HostStatusBadge } from "@/features/hosts/components/host-status-badge";
import { ServicesTable, type RowSelection } from "@/features/hosts/components/services-table";
import { TagList } from "@/features/hosts/components/tag-list";
import { TriageControl } from "@/features/hosts/components/triage-control";
import { CHANGE_CLASS } from "@/features/hosts/lib/badges";
import { DetectionBadges } from "@/features/signatures/components/detection-badges";
import { VulnerabilitySummaryBadge } from "@/features/vulnerabilities/components/vulnerability-summary";
import { createDataTableColumns } from "@/lib/data-table";
import { cn } from "@/lib/utils";

const MAX_HOSTNAMES = 2;
const MAX_PORTS = 8;

const column = createDataTableColumns<ScanHost>();

/** Ports colored by change: new, changed, or struck through when gone. */
function PortChips({ services }: { services: readonly ScanService[] }) {
  return (
    <span className="flex min-w-0 max-w-full flex-wrap gap-1">
      {services.slice(0, MAX_PORTS).map((service) => (
        <Badge
          key={service.id}
          variant="outline"
          className={cn(
            "h-auto max-w-full min-h-5 break-all whitespace-normal font-mono",
            service.change && service.change !== "unchanged" && CHANGE_CLASS[service.change],
            service.change === "gone" && "line-through",
          )}
        >
          {service.port}
          {service.observed.name || service.overrides.name
            ? `/${service.overrides.name ?? service.observed.name}`
            : ""}
        </Badge>
      ))}
      {services.length > MAX_PORTS && (
        <Badge variant="ghost">+{services.length - MAX_PORTS}</Badge>
      )}
    </span>
  );
}

interface HostsTableProps {
  hosts: ScanHost[];
  /** The scan has a base scan: show what changed. */
  compared: boolean;
  onOpen: (host: ScanHost) => void;
  onEditHost: (host: ScanHost) => void;
  onEditService: (host: ScanHost, service: ScanService) => void;
  /** Checkboxes for hosts and services, e.g. to push them to DefectDojo. */
  selection?: RowSelection;
}

export function HostsTable({
  hosts,
  compared,
  onOpen,
  onEditHost,
  onEditService,
  selection,
}: HostsTableProps) {
  const { t } = useTranslation("hosts");
  const { t: tv } = useTranslation("vulnerabilities");
  const { t: ts } = useTranslation("signatures");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const columns = useMemo(
    () =>
      column.columns([
        ...(selection
          ? [
              column.display({
                id: "select",
                header: () => <span className="sr-only">{t("columns.select")}</span>,
                meta: { className: "w-[3%]" },
                cell: ({ row: { original: host } }) => (
                  <Checkbox
                    checked={selection.hostIds.has(host.id)}
                    onCheckedChange={() => selection.toggleHost(host.id)}
                    aria-label={t("actions.select", { name: host.ip })}
                  />
                ),
              }),
            ]
          : []),
        column.display({
          id: "expand",
          header: () => <span className="sr-only">{t("columns.expand")}</span>,
          meta: { className: "w-[5%]" },
          cell: ({ row: { original: host } }) => {
            const open = expanded.has(host.id);
            return (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-expanded={open}
                aria-label={t(open ? "actions.collapse" : "actions.expand", { ip: host.ip })}
                onClick={() => toggle(host.id)}
              >
                {open ? <ChevronDown /> : <ChevronRight />}
              </Button>
            );
          },
        }),
        column.accessor("ip", {
          header: t("columns.host"),
          enableSorting: false,
          meta: {
            className: compared
              ? selection ? "w-[14%]" : "w-[17%]"
              : selection ? "w-[17%]" : "w-[20%]",
          },
          cell: ({ row: { original: host } }) => (
            <div className="grid gap-0.5">
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="w-fit font-mono font-medium hover:underline"
                  onClick={() => onOpen(host)}
                >
                  {host.ip}
                </button>
                {host.note && (
                  <span title={host.note} className="text-muted-foreground">
                    <StickyNote aria-hidden className="size-3.5" />
                    <span className="sr-only">
                      {t("columns.note")}: {host.note}
                    </span>
                  </span>
                )}
              </span>
              {host.hostnames.length > 0 && (
                <span className="wrap-anywhere text-xs text-muted-foreground">
                  {host.hostnames.slice(0, MAX_HOSTNAMES).join(", ")}
                  {host.hostnames.length > MAX_HOSTNAMES &&
                    ` +${host.hostnames.length - MAX_HOSTNAMES}`}
                </span>
              )}
            </div>
          ),
        }),
        column.accessor("status", {
          header: t("columns.status"),
          enableSorting: false,
          meta: { className: compared ? "w-[7%]" : "w-[8%]" },
          cell: ({ getValue }) => <HostStatusBadge status={getValue()} />,
        }),
        ...(compared
          ? [
              column.accessor("change", {
                header: t("columns.change"),
                enableSorting: false,
                meta: { className: "w-[8%]" },
                cell: ({ getValue }) => <ChangeBadge change={getValue()} />,
              }),
            ]
          : []),
        column.accessor("services", {
          header: t("columns.services"),
          enableSorting: false,
          meta: { className: compared ? "w-[15%]" : "w-[19%]" },
          cell: ({ getValue }) => <PortChips services={getValue()} />,
        }),
        column.accessor("vulnerabilities", {
          header: tv("columns.vulnerabilities"),
          enableSorting: false,
          meta: { className: "w-[11%]" },
          cell: ({ getValue }) => <VulnerabilitySummaryBadge summary={getValue()} />,
        }),
        column.accessor("detections", {
          header: ts("columns.detections"),
          enableSorting: false,
          meta: { className: "w-[14%]" },
          cell: ({ getValue }) => <DetectionBadges detections={getValue()} max={2} />,
        }),
        column.accessor("triage", {
          header: t("columns.triage"),
          enableSorting: false,
          meta: { className: "w-[15%]" },
          cell: ({ row: { original: host } }) => (
            <TriageControl
              target={{ hostId: host.id }}
              value={host.triage}
              rule={host.triageRule}
              label={t("actions.triageOf", { name: host.ip })}
            />
          ),
        }),
        column.accessor("tags", {
          header: t("columns.tags"),
          enableSorting: false,
          meta: { className: "w-[7%]" },
          cell: ({ getValue }) => <TagList tags={getValue()} />,
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("columns.actions")}</span>,
          meta: { className: "w-[9%]" },
          cell: ({ row: { original: host } }) => (
            <div className="flex justify-end gap-1">
              <IconAction
                label={t("actions.details", { ip: host.ip })}
                icon={<PanelRightOpen />}
                onClick={() => onOpen(host)}
              />
              <IconAction
                label={t("actions.editHost", { ip: host.ip })}
                icon={<Pencil />}
                permissions={["hosts:update"]}
                onClick={() => onEditHost(host)}
              />
            </div>
          ),
        }),
      ]),
    [t, tv, ts, compared, expanded, toggle, onOpen, onEditHost, selection],
  );

  return (
    <>
      <div className="grid gap-3 xl:hidden">
        {hosts.length === 0 && <p className="py-8 text-center text-muted-foreground">{t("noMatches")}</p>}
        {hosts.map((host) => {
          const open = expanded.has(host.id);
          return (
            <div key={host.id} className="min-w-0 rounded-lg border p-3 sm:p-4">
              <div className="flex min-w-0 flex-wrap items-start gap-2">
                {selection && <Checkbox checked={selection.hostIds.has(host.id)} onCheckedChange={() => selection.toggleHost(host.id)} aria-label={t("actions.select", { name: host.ip })} />}
                <div className="min-w-0 flex-1">
                  <button type="button" className="font-mono font-medium hover:underline" onClick={() => onOpen(host)}>{host.ip}</button>
                  {host.hostnames.length > 0 && <p className="wrap-anywhere text-xs text-muted-foreground">{host.hostnames.slice(0, MAX_HOSTNAMES).join(", ")}{host.hostnames.length > MAX_HOSTNAMES && ` +${host.hostnames.length - MAX_HOSTNAMES}`}</p>}
                </div>
                <HostStatusBadge status={host.status} />
                {compared && <ChangeBadge change={host.change} />}
              </div>
              <dl className="mt-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("columns.services")}</dt><dd className="mt-1"><PortChips services={host.services} /></dd></div>
                <div className="min-w-0"><dt className="text-xs text-muted-foreground">{tv("columns.vulnerabilities")}</dt><dd className="mt-1"><VulnerabilitySummaryBadge summary={host.vulnerabilities} /></dd></div>
                <div className="min-w-0"><dt className="text-xs text-muted-foreground">{ts("columns.detections")}</dt><dd className="mt-1"><DetectionBadges detections={host.detections} /></dd></div>
                <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("columns.triage")}</dt><dd className="mt-1"><TriageControl target={{ hostId: host.id }} value={host.triage} label={t("actions.triageOf", { name: host.ip })} /></dd></div>
                <div className="min-w-0"><dt className="text-xs text-muted-foreground">{t("columns.tags")}</dt><dd className="mt-1 wrap-anywhere"><TagList tags={host.tags} /></dd></div>
              </dl>
              <div className="mt-3 flex items-center gap-1 border-t pt-2">
                <Button variant="ghost" size="sm" aria-expanded={open} aria-label={t(open ? "actions.collapse" : "actions.expand", { ip: host.ip })} onClick={() => toggle(host.id)}>{open ? <ChevronDown /> : <ChevronRight />}{t("columns.services")}</Button>
                <div className="ml-auto flex gap-1">
                  <IconAction label={t("actions.details", { ip: host.ip })} icon={<PanelRightOpen />} onClick={() => onOpen(host)} />
                  <IconAction label={t("actions.editHost", { ip: host.ip })} icon={<Pencil />} permissions={["hosts:update"]} onClick={() => onEditHost(host)} />
                </div>
              </div>
              {open && <ServicesTable host={host} compared={compared} onEdit={onEditService} selection={selection} />}
            </div>
          );
        })}
      </div>
      <div className="hidden min-w-0 xl:block">
        <DataTable
          columns={columns}
          data={hosts}
          emptyLabel={t("noMatches")}
          tableClassName="table-fixed [&>tbody>tr>td:not([colspan])]:wrap-anywhere [&>tbody>tr>td:not([colspan])]:whitespace-normal"
          renderExpanded={(host) =>
            expanded.has(host.id) ? (
              <ServicesTable host={host} compared={compared} onEdit={onEditService} selection={selection} />
            ) : null
          }
        />
      </div>
    </>
  );
}
