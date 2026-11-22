import { ArrowLeft, FileJson, FileSpreadsheet, Printer } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { FindingSeverity } from "@subsurf/contracts/reports/reports.schema";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SEVERITY_CLASS } from "@/features/reports/lib/badges";
import { downloadFile, toCsv, type CsvTable } from "@/features/reports/lib/export";
import { useErrorMessage } from "@/hooks/use-error-message";
import { cn } from "@/lib/utils";

/** Title, what the report covers, and the print, JSON and CSV actions (hidden on paper). */
export function ReportShell({
  title,
  description,
  meta,
  fileName,
  json,
  csv,
  controls,
  children,
}: {
  title: string;
  description?: string;
  meta: readonly (string | null | undefined)[];
  fileName: string;
  json: unknown;
  csv: () => CsvTable;
  /** Report options (selects, inputs), shown above the report and left off the print. */
  controls?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation("reports");
  return (
    <div className="grid gap-6 print:gap-4">
      <Link
        to="/app/reports"
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-4" />
        {t("back")}
      </Link>
      <PageHeader
        title={title}
        description={
          <span className="grid gap-1">
            {description && <span>{description}</span>}
            {meta.filter(Boolean).map((line) => (
              <span key={line} className="text-sm">
                {line}
              </span>
            ))}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" onClick={() => window.print()}>
              <Printer />
              {t("actions.print")}
            </Button>
            <Button
              variant="outline"
              onClick={() => downloadFile(`${fileName}.json`, JSON.stringify(json, null, 2), "application/json")}
            >
              <FileJson />
              {t("actions.json")}
            </Button>
            <Button variant="outline" onClick={() => downloadFile(`${fileName}.csv`, toCsv(csv()), "text/csv;charset=utf-8")}>
              <FileSpreadsheet />
              {t("actions.csv")}
            </Button>
          </div>
        }
      />
      {controls && <div className="flex flex-wrap items-end gap-3 print:hidden">{controls}</div>}
      {children}
      <p className="text-xs text-muted-foreground">{t("meta.safety")}</p>
    </div>
  );
}

/** Loading and error states of a report query; renders `children` with the data. */
export function ReportQuery<T>({
  query,
  children,
}: {
  query: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined };
  children: (data: T) => ReactNode;
}) {
  const errorMessage = useErrorMessage();
  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  if (query.isError || query.data === undefined) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(query.error)}
      </p>
    );
  }
  return children(query.data);
}

export function ReportSection({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="print:break-inside-avoid-page print:shadow-none">
      <CardContent className="grid gap-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="print:hidden">{actions}</div>}
        </header>
        {children}
      </CardContent>
    </Card>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-xl font-semibold tabular-nums", tone)}>{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">{children}</dl>;
}

export interface ReportColumn<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

const DEFAULT_LIMIT = 25;

/** A plain table: screen shows the first rows with a toggle, print shows every row. */
export function ReportTable<T>({
  rows,
  columns,
  rowKey,
  limit = DEFAULT_LIMIT,
  empty,
}: {
  rows: readonly T[];
  columns: readonly ReportColumn<T>[];
  rowKey: (row: T, index: number) => string;
  limit?: number;
  empty?: string;
}) {
  const { t } = useTranslation("reports");
  const [expanded, setExpanded] = useState(false);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty ?? t("common.none")}</p>;
  const hidden = !expanded && rows.length > limit;

  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              {columns.map((column) => (
                <th key={column.header} scope="col" className={cn("px-2 py-2 font-medium", column.className)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className={cn("border-b align-top last:border-0 print:break-inside-avoid", hidden && index >= limit && "hidden print:table-row")}
              >
                {columns.map((column) => (
                  <td key={column.header} className={cn("px-2 py-2", column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <Button variant="ghost" size="sm" className="w-fit print:hidden" onClick={() => setExpanded((value) => !value)}>
          {expanded ? t("common.showFewer") : t("common.showAll", { count: rows.length })}
        </Button>
      )}
    </div>
  );
}

export function SeverityBadge({ severity }: { severity: FindingSeverity }) {
  const { t } = useTranslation("reports");
  return (
    <Badge variant="outline" className={SEVERITY_CLASS[severity]}>
      {t(`severity.${severity}`)}
    </Badge>
  );
}

/** The address, linked to its IP report, with its names underneath. */
export function HostCell({ ip, hostnames = [] }: { ip: string; hostnames?: readonly string[] }) {
  const { t } = useTranslation("reports");
  return (
    <div className="grid gap-0.5">
      <Link
        to={`/app/reports/ips/${ip}`}
        className="font-mono text-brand hover:underline print:text-foreground print:no-underline"
        title={t("common.ipReport", { ip })}
      >
        {ip}
      </Link>
      {hostnames.length > 0 && <span className="text-xs break-all text-muted-foreground">{hostnames.join(", ")}</span>}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs break-all">{children}</span>;
}

export function TagChips({ tags }: { tags: readonly string[] }) {
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="font-normal">
          {tag}
        </Badge>
      ))}
    </span>
  );
}
