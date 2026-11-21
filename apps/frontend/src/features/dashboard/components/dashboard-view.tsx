import { Activity, MinusCircle, PlusCircle, RefreshCcw } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { Change } from "@subsurf/contracts/dashboard/dashboard.schema";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboard } from "@/features/dashboard/api/get-dashboard";
import { useErrorMessage } from "@/hooks/use-error-message";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime } from "@/lib/format";

const KIND_VARIANT = { new: "default", disappeared: "destructive", changed: "secondary" } as const;

const column = createDataTableColumns<Change>();

function useChangeColumns() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  return useMemo(
    () =>
      column.columns([
        column.accessor("kind", {
          header: t("dashboard.recent.kind"),
          cell: ({ getValue }) => (
            <Badge variant={KIND_VARIANT[getValue()]}>{t(`dashboard.recent.kinds.${getValue()}`)}</Badge>
          ),
        }),
        column.accessor("host", { header: t("dashboard.recent.host") }),
        column.accessor("service", { header: t("dashboard.recent.service") }),
        column.accessor("detail", { header: t("dashboard.recent.detail"), enableSorting: false }),
        column.accessor("detectedAt", {
          header: t("dashboard.recent.detected"),
          sortFn: "datetime",
          cell: ({ getValue }) => formatDateTime(getValue(), locale),
        }),
      ]),
    [t, locale],
  );
}

export function DashboardView() {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const dashboard = useDashboard();
  const columns = useChangeColumns();

  if (dashboard.isPending) return <Skeleton className="h-64 w-full" />;
  if (dashboard.isError) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(dashboard.error)}
      </p>
    );
  }

  const { activeHosts, newServices, disappearedServices, changedServices, recentChanges } =
    dashboard.data;
  const stats = [
    { key: "activeHosts", value: activeHosts, Icon: Activity },
    { key: "newServices", value: newServices, Icon: PlusCircle },
    { key: "disappeared", value: disappearedServices, Icon: MinusCircle },
    { key: "changed", value: changedServices, Icon: RefreshCcw },
  ] as const;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ key, value, Icon }) => (
          <Card key={key}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t(`dashboard.stats.${key}`)}
              </CardTitle>
              <Icon className="size-4 text-brand" />
            </CardHeader>
            <CardContent className="text-3xl font-semibold tabular-nums">
              {value.toLocaleString()}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.recent.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable columns={columns} data={recentChanges} />
        </CardContent>
      </Card>
    </div>
  );
}
