import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import { intToIpv4, rangeSize } from "@subsurf/contracts/targets/ipv4";
import { TARGET_IMPORT_LIMITS } from "@subsurf/contracts/targets/target-input";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTablePagination } from "@/components/data-table-pagination";
import { IconAction } from "@/components/icon-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TargetKindBadge } from "@/features/targets/components/target-kind-badge";
import { isRowDropped, type EntryAnalysis, type FormEntry } from "@/features/targets/lib/entry-list";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const COLUMN_COUNT = 5;

// Enter in a row's note must not submit the import form around the list.
const keepEnter = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") event.preventDefault();
};

interface TargetEntryListProps {
  /** In insertion order; shown newest first. */
  entries: readonly FormEntry[];
  analysis: EntryAnalysis;
  page: number;
  onPageChange: (page: number) => void;
  onNoteChange: (value: string, note: string) => void;
  onRemove: (value: string) => void;
  onClear: () => void;
}

/**
 * Plain table rather than `DataTable`: rows hold inputs, keyed by their value, so typing a note
 * never remounts them, and there is nothing to sort.
 */
export function TargetEntryList({
  entries,
  analysis,
  page,
  onPageChange,
  onNoteChange,
  onRemove,
  onClear,
}: TargetEntryListProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [isClearing, setIsClearing] = useState(false);
  const { result, rowIssues } = analysis;

  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = useMemo(() => {
    const end = entries.length - (current - 1) * PAGE_SIZE;
    const start = Math.max(0, end - PAGE_SIZE);
    return entries
      .slice(start, end)
      .map((entry, index) => ({ entry, position: start + index + 1 }))
      .toReversed();
  }, [entries, current]);

  const toggle = (value: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(value)) next.add(value);
      return next;
    });

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("targets.import.entry.list.empty")}</p>;
  }

  return (
    <section className="grid gap-3" aria-labelledby="target-entry-list-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1 text-sm">
          <h2 id="target-entry-list-title" className="text-base font-medium">
            {t("targets.import.entry.list.title")}
          </h2>
          <p aria-live="polite">
            {t("targets.import.entry.list.summary", { count: entries.length })}
            {" · "}
            {t("targets.import.preview.ready", { count: result.entries.length })}
          </p>
          <p className="text-muted-foreground">
            {t("targets.import.preview.breakdown", result.stats)}
            {" · "}
            {t("targets.import.preview.addresses", { count: result.stats.addresses })}
          </p>
          {result.listErrors
            .filter((code) => code !== "empty")
            .map((code) => (
              <p key={code} role="alert" className="text-destructive">
                {t(`targets.import.listErrors.${code}`)}
              </p>
            ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setIsClearing(true)}>
          <Trash2 />
          {t("targets.import.entry.list.clear")}
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-24">{t("targets.columns.kind")}</TableHead>
            <TableHead>{t("targets.columns.value")}</TableHead>
            <TableHead className="w-28 text-right">{t("targets.import.entry.list.addresses")}</TableHead>
            <TableHead className="w-[32%]">{t("targets.columns.note")}</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">{t("targets.columns.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ entry, position }) => {
            const { parsed } = entry;
            const issues = rowIssues.get(position);
            const isOpen = parsed.kind === "range" && expanded.has(parsed.value);
            const display =
              parsed.kind === "range"
                ? `${intToIpv4(parsed.range.start)} – ${intToIpv4(parsed.range.end)}`
                : parsed.value;
            return (
              <Fragment key={parsed.value}>
                <TableRow className={cn(isRowDropped(issues) && "opacity-60")}>
                  <TableCell>
                    <TargetKindBadge kind={parsed.kind} />
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <div className="flex items-center gap-1">
                      {parsed.kind === "range" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-expanded={isOpen}
                          aria-label={t(
                            isOpen ? "targets.import.entry.list.collapse" : "targets.import.entry.list.expand",
                            { value: display },
                          )}
                          onClick={() => toggle(parsed.value)}
                        >
                          {isOpen ? <ChevronDown /> : <ChevronRight />}
                        </Button>
                      )}
                      <span className="font-mono break-all">{display}</span>
                    </div>
                    {issues?.map((issue) => (
                      <p key={`${issue.code}:${issue.detail ?? ""}`} className="text-xs text-muted-foreground">
                        {t(`targets.import.issues.${issue.code}`, { detail: issue.detail })}
                      </p>
                    ))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {parsed.range ? formatNumber(rangeSize(parsed.range), locale) : "—"}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={entry.note}
                      onChange={(event) => onNoteChange(parsed.value, event.target.value)}
                      onKeyDown={keepEnter}
                      maxLength={TARGET_IMPORT_LIMITS.maxNoteLength}
                      aria-label={t("targets.import.entry.list.note", { value: display })}
                      className="h-7"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <IconAction
                      label={t("targets.import.entry.list.remove", { value: display })}
                      icon={<Trash2 />}
                      onClick={() => onRemove(parsed.value)}
                      destructive
                    />
                  </TableCell>
                </TableRow>
                {isOpen && (
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={COLUMN_COUNT} className="whitespace-normal">
                      <p className="text-xs text-muted-foreground">
                        {t("targets.import.entry.list.blocks", { count: parsed.blocks.length })}
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs">
                        {parsed.blocks.map((block) => (
                          <li key={block.value}>{block.value}</li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {entries.length > PAGE_SIZE && (
        <DataTablePagination page={current} pageSize={PAGE_SIZE} total={entries.length} onPageChange={onPageChange} />
      )}

      {isClearing && (
        <ConfirmDialog
          title={t("targets.import.entry.clearDialog.title")}
          description={t("targets.import.entry.clearDialog.description", { count: entries.length })}
          confirmLabel={t("targets.import.entry.clearDialog.confirm")}
          destructive
          onConfirm={() => {
            onClear();
            setIsClearing(false);
          }}
          onCancel={() => setIsClearing(false)}
        />
      )}
    </section>
  );
}
