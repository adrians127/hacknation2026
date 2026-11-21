import { ChevronDown, ChevronRight, PanelRightOpen, Pencil, StickyNote } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { HostListItem, ServiceSummary } from "@subsurf/contracts/hosts/hosts.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HostStatusBadge } from "@/features/hosts/components/host-status-badge";
import { ServicesTable } from "@/features/hosts/components/services-table";
import { TagList } from "@/features/hosts/components/tag-list";
import { TriageControl } from "@/features/hosts/components/triage-control";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_HOSTNAMES = 2;
const MAX_PORTS = 8;

const column = createDataTableColumns<HostListItem>();

function PortChips({ services }: { services: readonly ServiceSummary[] }) {
  return (
    <span className="flex max-w-72 flex-wrap gap-1">
      {services.slice(0, MAX_PORTS).map((service) => (
        <Badge
          key={service.id}
          variant="outline"
          className={cn("font-mono", !service.seenInLatestScan && "opacity-50 line-through")}
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
  hosts: HostListItem[];
  onOpen: (host: HostListItem) => void;
  onEditHost: (host: HostListItem) => void;
  onEditService: (host: HostListItem, service: ServiceSummary) => void;
}

export function HostsTable({ hosts, onOpen, onEditHost, onEditService }: HostsTableProps) {
  const { t, i18n } = useTranslation("hosts");
  const locale = i18n.resolvedLanguage;
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
        column.display({
          id: "expand",
          header: () => <span className="sr-only">{t("columns.expand")}</span>,
          meta: { className: "w-10" },
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
                <span className="text-xs text-muted-foreground">
                  {host.hostnames.slice(0, MAX_HOSTNAMES).join(", ")}
                  {host.hostnames.length > MAX_HOSTNAMES &&
                    ` +${host.hostnames.length - MAX_HOSTNAMES}`}
                </span>
              )}
            </div>
          ),
        }),
        column.accessor("lastStatus", {
          header: t("columns.status"),
          enableSorting: false,
          cell: ({ getValue }) => <HostStatusBadge status={getValue()} />,
        }),
        column.accessor("services", {
          header: t("columns.services"),
          enableSorting: false,
          cell: ({ getValue }) => <PortChips services={getValue()} />,
        }),
        column.accessor("lastSeenAt", {
          header: t("columns.lastSeen"),
          enableSorting: false,
          meta: { className: "whitespace-nowrap text-muted-foreground" },
          cell: ({ getValue }) => formatDateTime(getValue(), locale),
        }),
        column.accessor("triage", {
          header: t("columns.triage"),
          enableSorting: false,
          cell: ({ row: { original: host } }) => (
            <TriageControl
              target={{ hostId: host.id }}
              value={host.triage}
              label={t("actions.triageOf", { name: host.ip })}
            />
          ),
        }),
        column.accessor("tags", {
          header: t("columns.tags"),
          enableSorting: false,
          cell: ({ getValue }) => <TagList tags={getValue()} />,
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("columns.actions")}</span>,
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
    [t, locale, expanded, toggle, onOpen, onEditHost],
  );

  return (
    <DataTable
      columns={columns}
      data={hosts}
      emptyLabel={t("noMatches")}
      renderExpanded={(host) =>
        expanded.has(host.id) ? <ServicesTable host={host} onEdit={onEditService} /> : null
      }
    />
  );
}
