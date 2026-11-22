import { Columns2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { DashboardResponse } from "@subsurf/contracts/dashboard/dashboard.schema";
import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/features/dashboard/api/get-dashboard";
import { StatTile, type TrendPoint } from "@/features/dashboard/components/stat-tile";
import { TopChangesTable } from "@/features/dashboard/components/top-changes-table";
import { useScans } from "@/features/scans/api/get-scans";
import { compareUrl, hasResults, scanDate } from "@/features/scans/lib/pair";
import { useErrorMessage } from "@/hooks/use-error-message";
import { formatDateTime, formatNumber } from "@/lib/format";

/** Scans with results up to the newest one, oldest first. */
function trendOf(scans: readonly Scan[], pick: (scan: Scan) => number): TrendPoint[] {
  return scans
    .filter(hasResults)
    .toReversed()
    .map((scan) => ({ date: scanDate(scan), value: pick(scan) }));
}

function Overview({ dashboard, scans }: { dashboard: DashboardResponse; scans: readonly Scan[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const { scan, baseScan, changes } = dashboard;
  if (!scan) return <p className="text-muted-foreground">{t("dashboard.noScans")}</p>;

  const base = scans.find((candidate) => candidate.id === baseScan?.id);
  const since = (now: number, before: number | undefined) => {
    if (before === undefined) return undefined;
    const delta = now - before;
    const signed = delta === 0 ? "±0" : `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta), locale)}`;
    return t("dashboard.stats.sinceBase", { delta: signed });
  };
  const link = (change: "new" | "gone" | "changed") =>
    baseScan ? compareUrl({ base: baseScan.id, target: scan.id, change }) : undefined;
  const date = (iso: string | null) => (iso ? formatDateTime(iso, locale) : "—");

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {baseScan
            ? t("dashboard.newest", { date: date(scan.startedAt), base: date(baseScan.startedAt) })
            : t("dashboard.newestFirst", { date: date(scan.startedAt) })}
        </p>
        {baseScan && (
          <Button asChild variant="outline" size="sm">
            <Link to={compareUrl({ base: baseScan.id, target: scan.id })}>
              <Columns2 />
              {t("dashboard.compare")}
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatTile
          label={t("dashboard.stats.hostsUp")}
          value={dashboard.hosts.up}
          hint={since(dashboard.hosts.up, base?.hosts.up)}
          trend={trendOf(scans, (entry) => entry.hosts.up)}
        />
        <StatTile
          label={t("dashboard.stats.openPorts")}
          value={dashboard.openPorts}
          hint={since(dashboard.openPorts, base?.openPorts)}
          trend={trendOf(scans, (entry) => entry.openPorts)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label={t("dashboard.stats.newHosts")} value={changes?.hosts.new ?? 0} to={link("new")} />
        <StatTile label={t("dashboard.stats.goneHosts")} value={changes?.hosts.gone ?? 0} to={link("gone")} />
        <StatTile
          label={t("dashboard.stats.serviceChanges")}
          value={changes ? changes.services.new + changes.services.gone + changes.services.changed : 0}
          hint={
            changes
              ? t("dashboard.stats.serviceChangesHint", {
                  new: formatNumber(changes.services.new, locale),
                  gone: formatNumber(changes.services.gone, locale),
                  changed: formatNumber(changes.services.changed, locale),
                })
              : undefined
          }
          to={link("changed")}
        />
        <StatTile
          label={t("dashboard.stats.unstable")}
          value={dashboard.hosts.unstable}
          hint={t("dashboard.stats.lifecycleHint")}
        />
        <StatTile
          label={t("dashboard.stats.inactive")}
          value={dashboard.hosts.inactive}
          hint={t("dashboard.stats.lifecycleHint")}
        />
      </div>

      {baseScan && (
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.top.title")}</CardTitle>
            <CardDescription>
              {t("dashboard.top.count", {
                high: formatNumber(dashboard.priorities.high, locale),
                medium: formatNumber(dashboard.priorities.medium, locale),
                low: formatNumber(dashboard.priorities.low, locale),
              })}
              {" · "}
              {t("dashboard.top.shown", {
                shown: dashboard.topChanges.length,
                total: dashboard.priorities.high + dashboard.priorities.medium + dashboard.priorities.low,
              })}
              {dashboard.muted > 0 && (
                <>
                  {" "}
                  <Link to="/app/rules" className="underline-offset-4 hover:underline">
                    {t("dashboard.top.muted", { count: dashboard.muted })}
                  </Link>
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TopChangesTable changes={dashboard.topChanges} baseId={baseScan.id} targetId={scan.id} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** The newest scan against the previous one (PDF item 15): headline numbers and what to look at. */
export function DashboardView() {
  const errorMessage = useErrorMessage();
  const dashboard = useDashboard();
  const scans = useScans();

  if (dashboard.isError || scans.isError) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(dashboard.error ?? scans.error)}
      </p>
    );
  }
  if (!dashboard.isSuccess || !scans.isSuccess) return <Skeleton className="h-96 w-full" />;
  return <Overview dashboard={dashboard.data} scans={scans.data.items} />;
}
