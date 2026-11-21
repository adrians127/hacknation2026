import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  isTargetWarning,
  type TargetIssue,
  type TargetIssueCode,
  type TargetParseResult,
} from "@subsurf/contracts/targets/target-input";

import { DataTable } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { createDataTableColumns } from "@/lib/data-table";

// Enough to spot the pattern; rendering 100k rows would freeze the page.
const MAX_ROWS = 100;

// A repeat is harmless (a warning) but still not imported.
const isDropped = (code: TargetIssueCode) => !isTargetWarning(code) || code === "duplicate";

const column = createDataTableColumns<TargetIssue>();

interface TargetImportPreviewProps {
  result: TargetParseResult;
  /** Text input reports lines, JSON reports array items. */
  position: "line" | "item";
}

export function TargetImportPreview({ result, position }: TargetImportPreviewProps) {
  const { t } = useTranslation();
  const { entries, issues, listErrors, stats } = result;
  const dropped = useMemo(() => issues.filter((issue) => isDropped(issue.code)).length, [issues]);
  const shown = useMemo(() => issues.slice(0, MAX_ROWS), [issues]);

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("position", {
          header: t(`targets.import.preview.${position}`),
          meta: { className: "w-20 tabular-nums" },
        }),
        column.accessor("raw", {
          header: t("targets.import.preview.value"),
          enableSorting: false,
          cell: ({ getValue }) => <span className="font-mono break-all">{getValue()}</span>,
        }),
        column.accessor("code", {
          header: t("targets.import.preview.problem"),
          enableSorting: false,
          cell: ({ getValue }) => {
            const code = getValue();
            return (
              <span className="flex flex-wrap items-center gap-2">
                <Badge variant={isTargetWarning(code) ? "secondary" : "destructive"}>
                  {t(isDropped(code) ? "targets.import.preview.rejected" : "targets.import.preview.changed")}
                </Badge>
                {t(`targets.import.issues.${code}`)}
              </span>
            );
          },
        }),
      ]),
    [t, position],
  );

  return (
    <section className="grid gap-3" aria-live="polite">
      <h2 className="font-medium">{t("targets.import.preview.title")}</h2>
      {listErrors.map((code) => (
        <p key={code} role="alert" className="text-sm text-destructive">
          {t(`targets.import.listErrors.${code}`)}
        </p>
      ))}
      <div className="grid gap-1 text-sm">
        <p className="font-medium">{t("targets.import.preview.ready", { count: entries.length })}</p>
        <p className="text-muted-foreground">
          {t("targets.import.preview.breakdown", stats)}
          {" · "}
          {t("targets.import.preview.addresses", { count: stats.addresses })}
        </p>
        {dropped > 0 && (
          <p className="text-muted-foreground">{t("targets.import.preview.skipped", { count: dropped })}</p>
        )}
      </div>
      {issues.length > 0 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">{t("targets.import.preview.issuesTitle")}</h3>
          <DataTable columns={columns} data={shown} />
          {issues.length > MAX_ROWS && (
            <p className="text-sm text-muted-foreground">
              {t("targets.import.preview.more", { count: issues.length - MAX_ROWS })}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
