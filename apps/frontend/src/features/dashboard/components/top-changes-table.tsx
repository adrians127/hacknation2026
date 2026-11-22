import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { DashboardChange } from "@subsurf/contracts/dashboard/dashboard.schema";
import type { ChangePriority } from "@subsurf/contracts/scans/scan-changes.schema";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { ChangeBadge } from "@/features/hosts/components/change-badge";
import { FieldChangeList } from "@/features/hosts/components/field-change-list";
import { LifecycleBadge } from "@/features/hosts/components/lifecycle-badge";
import { RuleBadge } from "@/features/rules/components/rule-badge";
import { compareUrl } from "@/features/scans/lib/pair";
import { createDataTableColumns } from "@/lib/data-table";

const MAX_FIELDS = 3;

const PRIORITY_CLASS: Record<ChangePriority, string> = {
  high: "border-red-500/40 bg-red-500/10 text-red-500",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  low: "text-muted-foreground",
};

const column = createDataTableColumns<DashboardChange>();

/** The newest scan's changes that deserve a look first; each opens in the comparison. */
export function TopChangesTable({
  changes,
  baseId,
  targetId,
}: {
  changes: DashboardChange[];
  baseId: string;
  targetId: string;
}) {
  const { t } = useTranslation();

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("priority", {
          header: t("dashboard.top.priority"),
          enableSorting: false,
          cell: ({ row: { original: change } }) => (
            <span className="flex items-center gap-1">
              <Badge variant="outline" className={PRIORITY_CLASS[change.priority]}>
                {t(`dashboard.priority.${change.priority}`)}
              </Badge>
              <RuleBadge rule={change.rule} compact />
            </span>
          ),
        }),
        column.accessor("ip", {
          header: t("dashboard.top.host"),
          enableSorting: false,
          cell: ({ row: { original: change } }) => (
            <div className="grid gap-0.5">
              <Link
                to={compareUrl({ base: baseId, target: targetId, host: change.hostId })}
                className="w-fit font-mono font-medium hover:underline"
              >
                {change.ip}
              </Link>
              {change.hostnames[0] && (
                <span className="text-xs text-muted-foreground">{change.hostnames[0]}</span>
              )}
            </div>
          ),
        }),
        column.accessor("port", {
          header: t("dashboard.top.port"),
          enableSorting: false,
          cell: ({ row: { original: change } }) =>
            change.port === null ? (
              <span className="text-muted-foreground">
                {t("dashboard.top.wholeHost")}
                {change.ports.length > 0 && (
                  <span className="block font-mono text-xs">{change.ports.join(", ")}</span>
                )}
              </span>
            ) : (
              <span className="font-mono">{change.port}</span>
            ),
        }),
        column.accessor("change", {
          header: t("dashboard.top.change"),
          enableSorting: false,
          cell: ({ row: { original: change } }) => (
            <span className="flex flex-wrap gap-1">
              <ChangeBadge change={change.change} />
              <LifecycleBadge lifecycle={change.lifecycle} />
            </span>
          ),
        }),
        column.display({
          id: "what",
          header: t("dashboard.top.what"),
          cell: ({ row: { original: change } }) => (
            <div className="grid gap-1">
              <span className="text-sm">
                {change.reasons.map((reason) => t(`dashboard.reasons.${reason}`)).join(", ")}
              </span>
              <FieldChangeList
                changes={change.fields.slice(0, MAX_FIELDS)}
                ip={change.ip}
                port={change.port ?? undefined}
              />
              {change.fields.length > MAX_FIELDS && (
                <span className="text-xs text-muted-foreground">+{change.fields.length - MAX_FIELDS}</span>
              )}
            </div>
          ),
        }),
      ]),
    [t, baseId, targetId],
  );

  return <DataTable columns={columns} data={changes} emptyLabel={t("dashboard.top.empty")} />;
}
