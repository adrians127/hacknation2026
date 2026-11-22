import { ArrowLeft, Download, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

import {
  ScanChangeFilterSchema,
  type HostHistoryEntry,
  type ScanChangeFilter,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { Scan } from "@subsurf/contracts/scans/scans.schema";

import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useScanHosts } from "@/features/hosts/api/get-scan-hosts";
import { CompareHostSheet } from "@/features/hosts/components/compare-host-sheet";
import { useExportChanges, type ChangesFormat } from "@/features/scans/api/export-changes";
import { useScan } from "@/features/scans/api/get-scan";
import { useScans } from "@/features/scans/api/get-scans";
import { ChangeFilterCards } from "@/features/scans/components/change-filter-cards";
import { CompareHostsTable } from "@/features/scans/components/compare-hosts-table";
import { ScanPairPicker } from "@/features/scans/components/scan-pair-picker";
import { ScanPairStats } from "@/features/scans/components/scan-pair-stats";
import { fileStamp, hasResults, orderPair } from "@/features/scans/lib/pair";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useErrorMessage } from "@/hooks/use-error-message";

const PAGE_SIZE = 50;
const NO_SCANS: Scan[] = [];
/** The change filter's "all hosts" value; without `change` the page shows any change. */
const ALL = "all";

function parsePage(raw: string | null): number {
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseChange(raw: string | null): ScanChangeFilter | undefined {
  if (raw === ALL) return undefined;
  const parsed = ScanChangeFilterSchema.safeParse(raw);
  return parsed.success ? parsed.data : "any";
}

/**
 * Two scans side by side (PDF items 8 and 9). A is always the older scan; without parameters
 * B is the newest scan with results and A the scan before it. State lives in the URL.
 */
export function ScanCompareRoute() {
  const { t } = useTranslation();
  const { t: th } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const page = parsePage(params.get("page"));
  const q = params.get("q") ?? "";
  const change = parseChange(params.get("change"));
  const openHostId = params.get("host");

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search.trim());

  const update = useCallback(
    (changes: Record<string, string | null | undefined>) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(changes)) {
            if (!value) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  useEffect(() => {
    if (debouncedSearch !== q) update({ q: debouncedSearch, page: null });
  }, [debouncedSearch, q, update]);

  const scans = useScans();
  const items = scans.data?.items ?? NO_SCANS;
  const baseParam = params.get("base") ?? undefined;
  const targetParam = params.get("target") ?? items.find(hasResults)?.id;
  // A pair given the wrong way round is read the right way round.
  const [baseRequested, targetId] =
    baseParam && targetParam && baseParam !== targetParam
      ? orderPair(items, baseParam, targetParam)
      : [undefined, targetParam];

  const target = useScan(targetId ?? "", baseRequested, { enabled: Boolean(targetId) });
  const baseId = baseRequested ?? target.data?.baseScan?.id;
  const base = useScan(baseId ?? "", undefined, { enabled: Boolean(baseId) });
  const hosts = useScanHosts(
    targetId ?? "",
    { base: baseId, page, pageSize: PAGE_SIZE, q: q || undefined, change },
    { enabled: Boolean(targetId && baseId) },
  );

  const exportChanges = useExportChanges();
  const download = (format: ChangesFormat) => {
    if (!targetId || !baseId) return;
    const [before, after] = [baseId, targetId].map((id) => items.find((scan) => scan.id === id));
    exportChanges.mutate(
      {
        scanId: targetId,
        base: baseId,
        format,
        fileName: `scan-changes-${fileStamp(before)}-to-${fileStamp(after)}.${format}`,
      },
      {
        onError: (error) => toast.error(t("scans.compare.exportFailed", { message: errorMessage(error) })),
      },
    );
  };

  const pickScan = useCallback(
    (entry: HostHistoryEntry) => {
      if (!targetId) return;
      const [older, newer] = orderPair(items, entry.scanId, targetId);
      update({ base: older, target: newer, page: null });
    },
    [items, targetId, update],
  );

  const header = (
    <>
      <Link
        to="/app/scans"
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("scans.detail.back")}
      </Link>
      <PageHeader
        title={t("scans.compare.title")}
        description={t("scans.compare.subtitle")}
        actions={
          targetId && baseId
            ? (["csv", "json"] as const).map((format) => (
                <Button
                  key={format}
                  variant="outline"
                  disabled={exportChanges.isPending}
                  onClick={() => download(format)}
                >
                  <Download />
                  {t("scans.compare.export", { format: format.toUpperCase() })}
                </Button>
              ))
            : undefined
        }
      />
    </>
  );

  if (scans.isPending) return <Skeleton className="h-96 w-full" />;
  if (scans.isError) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(scans.error)}
      </p>
    );
  }
  if (items.filter(hasResults).length < 2) {
    return (
      <div className="grid gap-6">
        {header}
        <p className="text-muted-foreground">{t("scans.compare.noScans")}</p>
      </div>
    );
  }

  const error = target.error ?? base.error;

  return (
    <div className="grid gap-6">
      {header}

      <Card>
        <CardContent className="grid gap-6">
          <ScanPairPicker
            scans={items}
            baseId={baseId}
            targetId={targetId}
            onChange={(pair) => update({ ...pair, page: null, host: null })}
          />
          {error ? (
            <p role="alert" className="text-destructive">
              {errorMessage(error)}
            </p>
          ) : target.isSuccess && !baseId ? (
            <p className="text-muted-foreground">{t("scans.compare.noBase")}</p>
          ) : target.isSuccess && base.isSuccess ? (
            <ScanPairStats base={base.data} target={target.data} />
          ) : (
            <Skeleton className="h-48 w-full" />
          )}
        </CardContent>
      </Card>

      {target.data?.changes && baseId && (
        <>
          <div className="grid gap-3">
            <ChangeFilterCards
              changes={target.data.changes}
              activeChange={change === "any" ? undefined : change}
              onChangeFilter={(next) => update({ change: next ?? null, page: null })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-64 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={th("search.placeholder")}
                aria-label={th("search.label")}
                className="pl-8"
              />
            </div>
            <Select
              value={change ?? ALL}
              onValueChange={(value) =>
                update({ change: value === "any" ? null : value, page: null })
              }
            >
              <SelectTrigger aria-label={th("filters.change")} className="min-w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{th("filters.allHosts")}</SelectItem>
                {ScanChangeFilterSchema.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {th(`filters.changes.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hosts.isPending ? (
            <Skeleton className="h-96 w-full" />
          ) : hosts.isError ? (
            <p role="alert" className="text-destructive">
              {errorMessage(hosts.error)}
            </p>
          ) : (
            <Card>
              <CardContent>
                <CompareHostsTable hosts={hosts.data.items} onOpen={(host) => update({ host: host.id })} />
                <DataTablePagination
                  page={hosts.data.page}
                  pageSize={hosts.data.pageSize}
                  total={hosts.data.total}
                  onPageChange={(next) => update({ page: next === 1 ? null : String(next) })}
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {openHostId && targetId && baseId && (
        <CompareHostSheet
          baseId={baseId}
          targetId={targetId}
          hostId={openHostId}
          onClose={() => update({ host: null })}
          onPickScan={pickScan}
        />
      )}
    </div>
  );
}
