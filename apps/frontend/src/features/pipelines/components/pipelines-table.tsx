import { ArrowRight, CalendarCheck, CalendarOff, Pencil, Play, Trash2 } from "lucide-react";
import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Pipeline } from "@subsurf/contracts/pipelines/pipelines.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { useScheduleSummary, useTargetsSummary } from "@/features/pipelines/lib/summaries";
import { SCAN_STATUS_VARIANT } from "@/features/scans/lib/status";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime } from "@/lib/format";

const column = createDataTableColumns<Pipeline>();

interface PipelinesTableProps {
  pipelines: Pipeline[];
  onRun: (pipeline: Pipeline) => void;
  onToggleSchedule: (pipeline: Pipeline) => void;
  onDelete: (pipeline: Pipeline) => void;
}

export function PipelinesTable({ pipelines, onRun, onToggleSchedule, onDelete }: PipelinesTableProps) {
  const { t, i18n } = useTranslation("pipelines");
  const { t: tc } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const scheduleSummary = useScheduleSummary();
  const targetsSummary = useTargetsSummary();

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("name", {
          header: t("list.columns.name"),
          cell: ({ row: { original: pipeline } }) => (
            <div className="grid gap-0.5">
              <Link to={`/app/pipelines/${pipeline.id}`} className="font-medium hover:underline">
                {pipeline.name}
              </Link>
              {pipeline.description && (
                <p className="max-w-xs text-sm text-muted-foreground">{pipeline.description}</p>
              )}
            </div>
          ),
        }),
        column.display({
          id: "steps",
          header: t("list.columns.steps"),
          cell: ({ row: { original: pipeline } }) => (
            <div className="flex flex-wrap items-center gap-1">
              {pipeline.steps.map((step, index) => (
                <Fragment key={step.position}>
                  {index > 0 && <ArrowRight className="size-3 text-muted-foreground" aria-hidden />}
                  <Badge variant="secondary">{step.worker.displayName}</Badge>
                </Fragment>
              ))}
            </div>
          ),
        }),
        column.display({
          id: "targets",
          header: t("list.columns.targets"),
          cell: ({ row: { original: pipeline } }) => (
            <span className="text-sm">{targetsSummary(pipeline.steps)}</span>
          ),
        }),
        column.display({
          id: "schedule",
          header: t("list.columns.schedule"),
          cell: ({ row: { original: pipeline } }) => (
            <div className="grid max-w-64 gap-1 text-sm">
              <span>{scheduleSummary(pipeline.schedule)}</span>
              {pipeline.schedule && !pipeline.enabled && (
                <Badge variant="outline" className="w-fit">
                  {t("list.scheduleOff")}
                </Badge>
              )}
            </div>
          ),
        }),
        column.accessor("nextRunAt", {
          header: t("list.columns.nextRun"),
          sortFn: "datetime",
          meta: { className: "text-muted-foreground tabular-nums" },
          cell: ({ getValue }) => {
            const next = getValue();
            return next ? formatDateTime(next, locale) : "—";
          },
        }),
        column.display({
          id: "lastRun",
          header: t("list.columns.lastRun"),
          cell: ({ row: { original: pipeline } }) => {
            const run = pipeline.activeRun ?? pipeline.lastRun;
            if (!run) return <span className="text-sm text-muted-foreground">{t("list.neverRun")}</span>;
            return (
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`/app/scans/${run.id}`} className="text-sm hover:underline">
                  {formatDateTime(run.startedAt ?? run.createdAt, locale)}
                </Link>
                <Badge variant={SCAN_STATUS_VARIANT[run.status]}>{tc(`scans.statuses.${run.status}`)}</Badge>
              </div>
            );
          },
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("list.columns.actions")}</span>,
          meta: { className: "text-right" },
          cell: ({ row: { original: pipeline } }) => (
            <div className="flex justify-end gap-1">
              <IconAction
                label={t("list.actions.runNow")}
                icon={<Play />}
                permissions={["scans:run"]}
                disabledReason={pipeline.activeRun ? t("list.runActive") : undefined}
                onClick={() => onRun(pipeline)}
              />
              <IconAction
                label={t(pipeline.enabled ? "list.actions.disable" : "list.actions.enable")}
                icon={pipeline.enabled ? <CalendarOff /> : <CalendarCheck />}
                permissions={["pipelines:update", "scans:run"]}
                disabledReason={pipeline.schedule ? undefined : t("list.noSchedule")}
                onClick={() => onToggleSchedule(pipeline)}
              />
              <IconAction label={t("list.actions.edit")} icon={<Pencil />} to={`/app/pipelines/${pipeline.id}`} />
              <IconAction
                label={t("list.actions.delete")}
                icon={<Trash2 />}
                permissions={["pipelines:delete"]}
                destructive
                onClick={() => onDelete(pipeline)}
              />
            </div>
          ),
        }),
      ]),
    [t, tc, locale, scheduleSummary, targetsSummary, onRun, onToggleSchedule, onDelete],
  );

  return <DataTable columns={columns} data={pipelines} />;
}
