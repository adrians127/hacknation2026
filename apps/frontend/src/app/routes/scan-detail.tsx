import { ArrowLeft, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";

import type { HostEdits, ServiceEdits, ServiceIdentity } from "@subsurf/contracts/hosts/hosts.schema";
import { TriageStatusSchema, type TriageStatus } from "@subsurf/contracts/hosts/hosts.schema";
import {
  ScanChangeFilterSchema,
  type ScanChangeFilter,
} from "@subsurf/contracts/scans/scan-results.schema";

import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DefectDojoPushActions } from "@/features/defectdojo/components/defectdojo-push-actions";
import { useScanHosts } from "@/features/hosts/api/get-scan-hosts";
import { HostEditDialog } from "@/features/hosts/components/host-edit-dialog";
import { HostSheet } from "@/features/hosts/components/host-sheet";
import { HostsTable } from "@/features/hosts/components/hosts-table";
import { ServiceEditDialog } from "@/features/hosts/components/service-edit-dialog";
import { useScan } from "@/features/scans/api/get-scan";
import { ScanSummary } from "@/features/scans/components/scan-summary";
import { SCAN_STATUS_VARIANT } from "@/features/scans/lib/status";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 50;
const ANY = "all";

type HostRef = HostEdits & { ip: string };
type ServiceRef = ServiceEdits & { port: number; protocol: string; observed: ServiceIdentity };
type Dialog =
  | { kind: "host"; host: HostRef }
  | { kind: "service"; host: HostRef; service: ServiceRef };

type IdSet = ReadonlySet<string>;

function toggled(set: IdSet, id: string): IdSet {
  const next = new Set(set);
  if (!next.delete(id)) next.add(id);
  return next;
}

function parsePage(raw: string | null): number {
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function parseOr<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, raw: string | null): T | undefined {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * One scan: what it found, how that changed since the previous scan, and its hosts.
 * List state lives in the URL, so a filtered view or an open host can be shared and reloaded.
 */
export function ScanDetailRoute() {
  const { scanId = "" } = useParams();
  const { t, i18n } = useTranslation();
  const { t: th } = useTranslation("hosts");
  const locale = i18n.resolvedLanguage;
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const page = parsePage(params.get("page"));
  const q = params.get("q") ?? "";
  const triage: TriageStatus | undefined = parseOr(TriageStatusSchema, params.get("triage"));
  const change: ScanChangeFilter | undefined = parseOr(ScanChangeFilterSchema, params.get("change"));
  const openHostId = params.get("host");

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search.trim());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // Kept across pages and filters, so a selection can be built from several searches.
  const [selectedHosts, setSelectedHosts] = useState<IdSet>(() => new Set());
  const [selectedServices, setSelectedServices] = useState<IdSet>(() => new Set());
  const canExport = useCan("defectdojo:export");
  const clearSelection = useCallback(() => {
    setSelectedHosts(new Set());
    setSelectedServices(new Set());
  }, []);
  const selection = useMemo(
    () => ({
      hostIds: selectedHosts,
      serviceIds: selectedServices,
      toggleHost: (id: string) => setSelectedHosts((previous) => toggled(previous, id)),
      toggleService: (id: string) => setSelectedServices((previous) => toggled(previous, id)),
    }),
    [selectedHosts, selectedServices],
  );

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

  const scan = useScan(scanId);
  const hosts = useScanHosts(scanId, { page, pageSize: PAGE_SIZE, q: q || undefined, triage, change });

  const openHost = useCallback((host: { id: string }) => update({ host: host.id }), [update]);
  const editHost = useCallback((host: HostRef) => setDialog({ kind: "host", host }), []);
  const editService = useCallback(
    (host: HostRef, service: ServiceRef) => setDialog({ kind: "service", host, service }),
    [],
  );

  if (scan.isPending) return <Skeleton className="h-96 w-full" />;
  if (scan.isError) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(scan.error)}
      </p>
    );
  }
  const scanData = scan.data;

  return (
    <div className="grid gap-6">
      <Link
        to="/app/scans"
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {t("scans.detail.back")}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {t("scans.detail.title", {
              date: formatDateTime(scanData.startedAt ?? scanData.createdAt, locale),
            })}
            <Badge variant={SCAN_STATUS_VARIANT[scanData.status]}>
              {t(`scans.statuses.${scanData.status}`)}
            </Badge>
          </span>
        }
        description={t("scans.detail.subtitle")}
        actions={
          <DefectDojoPushActions
            scanId={scanId}
            selection={selection}
            onClearSelection={clearSelection}
          />
        }
      />

      <ScanSummary
        scan={scanData}
        activeChange={change}
        onChangeFilter={(next) => update({ change: next ?? null, page: null })}
      />

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
        {scanData.changes && (
          <Select
            value={change ?? ANY}
            onValueChange={(value) => update({ change: value === ANY ? null : value, page: null })}
          >
            <SelectTrigger aria-label={th("filters.change")} className="min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{th("filters.allHosts")}</SelectItem>
              {ScanChangeFilterSchema.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {th(`filters.changes.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={triage ?? ANY}
          onValueChange={(value) => update({ triage: value === ANY ? null : value, page: null })}
        >
          <SelectTrigger aria-label={th("filters.triage")} className="min-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{th("filters.anyTriage")}</SelectItem>
            {TriageStatusSchema.options.map((status) => (
              <SelectItem key={status} value={status}>
                {th(`triage.${status}`)}
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
            <HostsTable
              hosts={hosts.data.items}
              compared={scanData.changes !== null}
              onOpen={openHost}
              onEditHost={editHost}
              onEditService={editService}
              selection={canExport ? selection : undefined}
            />
            <DataTablePagination
              page={hosts.data.page}
              pageSize={hosts.data.pageSize}
              total={hosts.data.total}
              onPageChange={(next) => update({ page: next === 1 ? null : String(next) })}
            />
          </CardContent>
        </Card>
      )}

      {openHostId && (
        <HostSheet
          scanId={scanId}
          hostId={openHostId}
          onClose={() => update({ host: null })}
          onEditHost={editHost}
          onEditService={editService}
        />
      )}

      {dialog?.kind === "host" && (
        <HostEditDialog key={dialog.host.id} host={dialog.host} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "service" && (
        <ServiceEditDialog
          key={dialog.service.id}
          hostId={dialog.host.id}
          hostIp={dialog.host.ip}
          service={dialog.service}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
