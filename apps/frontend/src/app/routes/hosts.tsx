import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";

import {
  TriageStatusSchema,
  type HostListItem,
  type ServiceSummary,
  type TriageStatus,
} from "@subsurf/contracts/hosts/hosts.schema";

import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useHosts } from "@/features/hosts/api/get-hosts";
import { HostEditDialog } from "@/features/hosts/components/host-edit-dialog";
import { HostSheet } from "@/features/hosts/components/host-sheet";
import { HostsTable } from "@/features/hosts/components/hosts-table";
import { ServiceEditDialog } from "@/features/hosts/components/service-edit-dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useErrorMessage } from "@/hooks/use-error-message";

const PAGE_SIZE = 50;
const ANY_TRIAGE = "any";

type HostRef = Pick<HostListItem, "id" | "ip" | "note" | "tags" | "triage">;
type Dialog =
  | { kind: "host"; host: HostRef }
  | { kind: "service"; host: Pick<HostListItem, "id" | "ip">; service: ServiceSummary };

function parsePage(raw: string | null): number {
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** List state lives in the URL, so a filtered page or an open host can be shared and reloaded. */
export function HostsRoute() {
  const { t } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const page = parsePage(params.get("page"));
  const q = params.get("q") ?? "";
  const triageParam = TriageStatusSchema.safeParse(params.get("triage"));
  const triage: TriageStatus | undefined = triageParam.success ? triageParam.data : undefined;
  const openHostId = params.get("host");

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search.trim());
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const update = useCallback(
    (changes: Record<string, string | null>) =>
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === "") next.delete(key);
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

  const hosts = useHosts({ page, pageSize: PAGE_SIZE, q: q || undefined, triage });

  const openHost = useCallback((host: { id: string }) => update({ host: host.id }), [update]);
  const editHost = useCallback((host: HostRef) => setDialog({ kind: "host", host }), []);
  const editService = useCallback(
    (host: Pick<HostListItem, "id" | "ip">, service: ServiceSummary) =>
      setDialog({ kind: "service", host, service }),
    [],
  );

  return (
    <div className="grid gap-6">
      <PageHeader title={t("title")} description={t("subtitle")} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.label")}
            className="pl-8"
          />
        </div>
        <Select
          value={triage ?? ANY_TRIAGE}
          onValueChange={(value) => update({ triage: value === ANY_TRIAGE ? null : value, page: null })}
        >
          <SelectTrigger aria-label={t("filters.triage")} className="min-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_TRIAGE}>{t("filters.anyTriage")}</SelectItem>
            {TriageStatusSchema.options.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`triage.${status}`)}
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
            {hosts.data.total === 0 && !q && !triage ? (
              <p className="py-12 text-center text-muted-foreground">{t("empty")}</p>
            ) : (
              <>
                <HostsTable
                  hosts={hosts.data.items}
                  onOpen={openHost}
                  onEditHost={editHost}
                  onEditService={editService}
                />
                <DataTablePagination
                  page={hosts.data.page}
                  pageSize={hosts.data.pageSize}
                  total={hosts.data.total}
                  onPageChange={(next) => update({ page: next === 1 ? null : String(next) })}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {openHostId && (
        <HostSheet
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
