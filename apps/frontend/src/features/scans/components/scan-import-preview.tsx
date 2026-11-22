import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  summarizeScanImport,
  type ScanImportIssue,
  type ScanImportRead,
} from "@subsurf/contracts/scans/scan-import";

import { DataTable } from "@/components/data-table";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime, formatNumber } from "@/lib/format";

// Enough to spot the pattern in a broken file.
const MAX_ROWS = 100;

const column = createDataTableColumns<ScanImportIssue>();

function IssuesTable({ issues }: { issues: readonly ScanImportIssue[] }) {
  const { t } = useTranslation();
  const shown = useMemo(() => issues.slice(0, MAX_ROWS), [issues]);
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("position", {
          header: t("scans.import.preview.position"),
          meta: { className: "w-20 tabular-nums" },
          cell: ({ getValue }) => getValue() ?? "—",
        }),
        column.accessor("code", {
          header: t("scans.import.preview.problem"),
          enableSorting: false,
          cell: ({ row }) => (
            <span className="break-words">
              {t(`scans.import.issues.${row.original.code}`, { detail: row.original.detail })}
            </span>
          ),
        }),
      ]),
    [t],
  );

  return (
    <div className="grid gap-2">
      <DataTable columns={columns} data={shown} />
      {issues.length > MAX_ROWS && (
        <p className="text-sm text-muted-foreground">
          {t("scans.import.preview.more", { count: issues.length - MAX_ROWS })}
        </p>
      )}
    </div>
  );
}

/** What importing the file would add, or why it cannot be imported. */
export function ScanImportPreview({ read }: { read: ScanImportRead }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;

  if (!read.ok) {
    return (
      <section className="grid gap-3" aria-live="polite">
        <p role="alert" className="font-medium text-destructive">
          {t("scans.import.preview.cannotImport")}
        </p>
        <IssuesTable issues={read.errors} />
      </section>
    );
  }

  const summary = summarizeScanImport(read.import);
  const counts = [
    ["addresses", summary.addresses],
    ["up", summary.up],
    ["down", summary.down],
    ["noAnswer", summary.noAnswer],
    ["openPorts", summary.openPorts],
    ["httpEndpoints", summary.httpEndpoints],
  ] as const;

  return (
    <section className="grid gap-4" aria-live="polite">
      <h2 className="font-medium">{t("scans.import.preview.title")}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("scans.import.preview.format")}</dt>
        <dd>{t(`scans.import.formats.${read.import.inputFormat}`)}</dd>
        <dt className="text-muted-foreground">{t("scans.import.preview.ran")}</dt>
        <dd>
          {summary.recordedAt
            ? formatDateTime(summary.recordedAt, locale)
            : t("scans.import.preview.ranUnknown")}
        </dd>
        {counts.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{t(`scans.import.preview.${key}`)}</dt>
            <dd className="tabular-nums">{formatNumber(value, locale)}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">{t("scans.import.preview.edits")}</dt>
        <dd>
          {t("scans.import.preview.editsValue", {
            hosts: summary.hostEdits,
            services: summary.serviceEdits,
          })}
        </dd>
      </dl>
      {summary.recordedAt && (
        <p className="text-sm text-muted-foreground">{t("scans.import.preview.placement")}</p>
      )}
      {read.warnings.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">
            {t("scans.import.preview.warningsTitle", { count: read.warnings.length })}
          </h3>
          <IssuesTable issues={read.warnings} />
        </div>
      )}
    </section>
  );
}
