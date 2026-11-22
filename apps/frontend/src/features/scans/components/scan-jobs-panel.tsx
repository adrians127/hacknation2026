import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { ScanJob, ScanStep } from "@subsurf/contracts/scans/scan-jobs.schema";
import { ScanJobStatusSchema, type ScanJobStatus } from "@subsurf/contracts/scans/scans.schema";

import { DataTable } from "@/components/data-table";
import { DataTablePagination } from "@/components/data-table-pagination";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useScanJobs } from "@/features/scans/api/get-scan-jobs";
import { JOB_STATUS_VARIANT } from "@/features/scans/lib/status";
import { useErrorMessage } from "@/hooks/use-error-message";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDuration, formatNumber } from "@/lib/format";

const PAGE_SIZE = 50;
const ANY = "all";

const column = createDataTableColumns<ScanJob>();

function StepProgress({ step }: { step: ScanStep }) {
  const { t } = useTranslation();
  const { queued, leased, completed, failed, stopped } = step.jobs;
  const total = queued + leased + completed + failed + stopped;
  const done = completed + failed + stopped;
  const segments: [ScanJobStatus, number, string][] = [
    ["completed", completed, "bg-brand"],
    ["failed", failed, "bg-destructive"],
    ["stopped", stopped, "bg-muted-foreground"],
    ["leased", leased, "bg-brand/40"],
  ];

  return (
    <li className="grid gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">
          {t("scans.jobs.step", { index: step.index, worker: step.worker })}
          <span className="ml-2 font-normal text-muted-foreground">
            {step.input === "previous"
              ? t("scans.jobs.stepInput.previous", { index: step.index - 1 })
              : t("scans.jobs.stepInput.targets")}
          </span>
        </span>
        <span className="text-muted-foreground tabular-nums">
          {total === 0 ? t("scans.jobs.waiting") : t("scans.jobs.progress", { done, total })}
        </span>
      </div>
      {/* The counts are in the text above; the bar repeats them visually. */}
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
        {total > 0 &&
          segments.map(([status, count, color]) =>
            count > 0 ? <div key={status} className={color} style={{ width: `${(count / total) * 100}%` }} /> : null,
          )}
      </div>
    </li>
  );
}

interface ScanJobsPanelProps {
  scanId: string;
  steps: ScanStep[];
  live: boolean;
  page: number;
  step: number | undefined;
  status: ScanJobStatus | undefined;
  onChange: (changes: Record<string, string | null>) => void;
}

/** The scan's pipeline steps with their progress, and its jobs. Filters live in the URL. */
export function ScanJobsPanel({ scanId, steps, live, page, step, status, onChange }: ScanJobsPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const errorMessage = useErrorMessage();
  const jobs = useScanJobs(scanId, { page, pageSize: PAGE_SIZE, step, status }, live);
  const workerOf = useMemo(() => new Map(steps.map((entry) => [entry.index, entry.worker])), [steps]);

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("sequence", {
          header: t("scans.jobs.columns.sequence"),
          enableSorting: false,
          meta: { className: "tabular-nums text-muted-foreground" },
        }),
        column.accessor("stepIndex", {
          header: t("scans.jobs.columns.step"),
          enableSorting: false,
          cell: ({ row: { original: job } }) => (
            <span>
              {job.stepIndex} · {workerOf.get(job.stepIndex) ?? job.worker}
            </span>
          ),
        }),
        column.accessor("subnet", {
          header: t("scans.jobs.columns.subnet"),
          enableSorting: false,
          cell: ({ row: { original: job } }) => (
            <div className="grid">
              <code className="text-xs">{job.subnet}</code>
              <span className="text-xs text-muted-foreground">
                {t("scans.jobs.addresses", { count: job.addressCount, formatted: formatNumber(job.addressCount, locale) })}
              </span>
            </div>
          ),
        }),
        column.accessor("status", {
          header: t("scans.jobs.columns.status"),
          enableSorting: false,
          cell: ({ getValue }) => (
            <Badge variant={JOB_STATUS_VARIANT[getValue()]}>{t(`scans.jobs.statuses.${getValue()}`)}</Badge>
          ),
        }),
        column.accessor("attempts", {
          header: t("scans.jobs.columns.attempts"),
          enableSorting: false,
          meta: { className: "text-right tabular-nums" },
        }),
        column.accessor("leasedBy", {
          header: t("scans.jobs.columns.leasedBy"),
          enableSorting: false,
          cell: ({ getValue }) => <code className="text-xs">{getValue() ?? "—"}</code>,
        }),
        column.accessor("durationMs", {
          header: t("scans.jobs.columns.duration"),
          enableSorting: false,
          meta: { className: "tabular-nums" },
          cell: ({ getValue }) => {
            const ms = getValue();
            return ms === null ? "—" : formatDuration(Math.round(ms / 1000));
          },
        }),
        column.accessor("resultCount", {
          header: t("scans.jobs.columns.results"),
          enableSorting: false,
          meta: { className: "text-right tabular-nums" },
        }),
        column.accessor("error", {
          header: t("scans.jobs.columns.error"),
          enableSorting: false,
          cell: ({ getValue }) => {
            const error = getValue();
            return error ? (
              <span className="text-xs text-destructive" title={error.message}>
                {error.code}
              </span>
            ) : null;
          },
        }),
      ]),
    [t, locale, workerOf],
  );

  return (
    <div className="grid gap-4">
      {steps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("scans.jobs.steps")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="grid gap-4">
              {steps.map((entry) => (
                <StepProgress key={entry.index} step={entry} />
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-3">
        <Select
          value={step === undefined ? ANY : String(step)}
          onValueChange={(value) => onChange({ step: value === ANY ? null : value, jobsPage: null })}
        >
          <SelectTrigger aria-label={t("scans.jobs.filters.step")} className="min-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("scans.jobs.filters.allSteps")}</SelectItem>
            {steps.map((entry) => (
              <SelectItem key={entry.index} value={String(entry.index)}>
                {t("scans.jobs.step", { index: entry.index, worker: entry.worker })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status ?? ANY}
          onValueChange={(value) => onChange({ jobStatus: value === ANY ? null : value, jobsPage: null })}
        >
          <SelectTrigger aria-label={t("scans.jobs.filters.status")} className="min-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("scans.jobs.filters.allStatuses")}</SelectItem>
            {ScanJobStatusSchema.options.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`scans.jobs.statuses.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {jobs.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : jobs.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(jobs.error)}
        </p>
      ) : (
        <Card>
          <CardContent>
            {jobs.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("scans.jobs.empty")}</p>
            ) : (
              <DataTable columns={columns} data={jobs.data.items} />
            )}
            <DataTablePagination
              page={jobs.data.page}
              pageSize={jobs.data.pageSize}
              total={jobs.data.total}
              onPageChange={(next) => onChange({ jobsPage: next === 1 ? null : String(next) })}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
