import { PanelRightOpen } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ScanChange, ScanHost, ScanService } from "@subsurf/contracts/scans/scan-results.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { HostStatusBadge } from "@/features/hosts/components/host-status-badge";
import { LifecycleBadge } from "@/features/hosts/components/lifecycle-badge";
import { CHANGE_CLASS } from "@/features/hosts/lib/badges";
import { createDataTableColumns } from "@/lib/data-table";
import { cn } from "@/lib/utils";

const MAX_HOSTNAMES = 2;
const MAX_PORTS = 10;

const column = createDataTableColumns<ScanHost>();

const identity = (observed: ScanService["observed"]) =>
  [observed.product, observed.version].filter(Boolean).join(" ") || observed.name || "?";

interface Chip {
  service: ScanService;
  name: string | null;
  tone: ScanChange | null;
  /** What differs, shown on hover. */
  hint?: string;
}

function Chips({ chips }: { chips: readonly Chip[] }) {
  if (chips.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex max-w-80 flex-wrap gap-1">
      {chips.slice(0, MAX_PORTS).map(({ service, name, tone, hint }) => (
        <Badge
          key={service.id}
          variant="outline"
          title={hint}
          className={cn("font-mono", tone && tone !== "unchanged" && CHANGE_CLASS[tone])}
        >
          {service.port}
          {name ? `/${name}` : ""}
          {tone === "changed" && <span aria-hidden>●</span>}
        </Badge>
      ))}
      {chips.length > MAX_PORTS && <Badge variant="ghost">+{chips.length - MAX_PORTS}</Badge>}
    </span>
  );
}

/** Scan A's side: every port it saw open, red if B no longer has it. */
function baseChips(host: ScanHost): Chip[] {
  return host.services.flatMap((service) =>
    service.before
      ? [
          {
            service,
            name: service.before.observed.name,
            tone: service.change === "gone" || service.change === "changed" ? service.change : null,
          },
        ]
      : [],
  );
}

/** Scan B's side: every port it saw open, green if new, amber with what differs if changed. */
function targetChips(host: ScanHost): Chip[] {
  if (host.status !== "up") return [];
  return host.services
    .filter((service) => service.change !== "gone")
    .map((service) => {
      const before = service.before ? identity(service.before.observed) : null;
      const after = identity(service.observed);
      return {
        service,
        name: service.observed.name,
        tone: service.change === "new" || service.change === "changed" ? service.change : null,
        hint: service.change === "changed" && before !== after ? `${before} → ${after}` : undefined,
      };
    });
}

/** The hosts of a comparison: what each scan got from the address and saw open. */
export function CompareHostsTable({
  hosts,
  onOpen,
}: {
  hosts: ScanHost[];
  onOpen: (host: ScanHost) => void;
}) {
  const { t } = useTranslation("hosts");
  const { t: tc } = useTranslation();

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("ip", {
          header: tc("scans.compare.columns.host"),
          enableSorting: false,
          cell: ({ row: { original: host } }) => (
            <div className="grid gap-0.5">
              <button
                type="button"
                className="w-fit font-mono font-medium hover:underline"
                onClick={() => onOpen(host)}
              >
                {host.ip}
              </button>
              {host.hostnames.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {host.hostnames.slice(0, MAX_HOSTNAMES).join(", ")}
                  {host.hostnames.length > MAX_HOSTNAMES && ` +${host.hostnames.length - MAX_HOSTNAMES}`}
                </span>
              )}
            </div>
          ),
        }),
        column.accessor("change", {
          header: tc("scans.compare.columns.change"),
          enableSorting: false,
          cell: ({ row: { original: host } }) => (
            <span className="flex flex-wrap gap-1">
              <ChangeBadge change={host.change} />
              <LifecycleBadge lifecycle={host.lifecycle} />
            </span>
          ),
        }),
        column.display({
          id: "base",
          header: tc("scans.compare.base"),
          cell: ({ row: { original: host } }) => (
            <div className="grid justify-items-start gap-1">
              {host.baseStatus ? (
                <HostStatusBadge status={host.baseStatus} />
              ) : (
                <Badge variant="outline" className="border-dashed text-muted-foreground">
                  {t("compare.notScanned")}
                </Badge>
              )}
              <Chips chips={baseChips(host)} />
            </div>
          ),
        }),
        column.display({
          id: "target",
          header: tc("scans.compare.target"),
          cell: ({ row: { original: host } }) => (
            <div className="grid justify-items-start gap-1">
              <HostStatusBadge status={host.status} />
              <Chips chips={targetChips(host)} />
            </div>
          ),
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("columns.actions")}</span>,
          cell: ({ row: { original: host } }) => (
            <div className="flex justify-end">
              <IconAction
                label={t("actions.details", { ip: host.ip })}
                icon={<PanelRightOpen />}
                onClick={() => onOpen(host)}
              />
            </div>
          ),
        }),
      ]),
    [t, tc, onOpen],
  );

  return <DataTable columns={columns} data={hosts} emptyLabel={t("noMatches")} />;
}
