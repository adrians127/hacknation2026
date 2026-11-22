import { Plus, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { TargetKindSchema, type Target } from "@subsurf/contracts/targets/targets.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTablePagination } from "@/components/data-table-pagination";
import { GuardedButton } from "@/components/guarded-button";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteTarget } from "@/features/targets/api/delete-target";
import { useTargets } from "@/features/targets/api/get-targets";
import { TargetDialog } from "@/features/targets/components/target-dialog";
import { TargetsTable } from "@/features/targets/components/targets-table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useErrorMessage } from "@/hooks/use-error-message";
import { parseOr, parsePage } from "@/lib/search-params";

const PAGE_SIZE = 50;
const ANY = "all";
const MAX_TAG_LENGTH = 50;

type Dialog = { kind: "edit"; target: Target } | { kind: "delete"; target: Target };

/**
 * The target inventory, paged and filtered by the server. The filters and the page live in the
 * URL, so a filtered view can be shared and reloaded.
 */
export function TargetsRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const [params, setParams] = useSearchParams();
  const page = parsePage(params.get("page"));
  const q = params.get("q") ?? "";
  const kind = parseOr(TargetKindSchema, params.get("kind"));
  const tag = (params.get("tag") ?? "").trim().slice(0, MAX_TAG_LENGTH);

  const [search, setSearch] = useState(q);
  const debouncedSearch = useDebouncedValue(search.trim());
  const deleteTarget = useDeleteTarget();
  const [dialog, setDialog] = useState<Dialog | null>(null);

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

  const targets = useTargets({
    page,
    pageSize: PAGE_SIZE,
    q: q || undefined,
    kind,
    tag: tag || undefined,
  });
  const isFiltered = q !== "" || kind !== undefined || tag !== "";

  const editTarget = useCallback((target: Target) => setDialog({ kind: "edit", target }), []);
  const removeTarget = useCallback((target: Target) => setDialog({ kind: "delete", target }), []);
  const filterTag = useCallback((next: string) => update({ tag: next, page: null }), [update]);

  function closeDialog() {
    setDialog(null);
    deleteTarget.reset();
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("targets.title")}
        description={t("targets.subtitle")}
        actions={
          <GuardedButton permissions={["targets:create"]} onClick={() => void navigate("/app/targets/new")}>
            <Plus />
            {t("targets.add")}
          </GuardedButton>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-64 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("targets.search.placeholder")}
            aria-label={t("targets.search.label")}
            className="pl-8"
          />
        </div>
        <Select
          value={kind ?? ANY}
          onValueChange={(value) => update({ kind: value === ANY ? null : value, page: null })}
        >
          <SelectTrigger aria-label={t("targets.filters.kind")} className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t("targets.filters.allKinds")}</SelectItem>
            {TargetKindSchema.options.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`targets.kinds.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tag && (
          <button
            type="button"
            onClick={() => update({ tag: null, page: null })}
            aria-label={t("targets.filters.clearTag", { tag })}
            className="rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Badge variant="secondary" className="gap-1 py-1">
              {tag}
              <X className="size-3" />
            </Badge>
          </button>
        )}
      </div>

      {targets.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : targets.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(targets.error)}
        </p>
      ) : targets.data.total === 0 && isFiltered ? (
        <p className="text-muted-foreground">{t("targets.emptyFiltered")}</p>
      ) : (
        <Card>
          <CardContent>
            <TargetsTable
              targets={targets.data.items}
              onEdit={editTarget}
              onDelete={removeTarget}
              onFilterTag={filterTag}
            />
            <DataTablePagination
              page={targets.data.page}
              pageSize={targets.data.pageSize}
              total={targets.data.total}
              onPageChange={(next) => update({ page: next === 1 ? null : String(next) })}
            />
          </CardContent>
        </Card>
      )}

      {dialog?.kind === "edit" && (
        <TargetDialog key={dialog.target.id} target={dialog.target} onClose={closeDialog} />
      )}

      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={t("targets.confirmDelete.title", { value: dialog.target.value })}
          description={t("targets.confirmDelete.description")}
          confirmLabel={t("targets.confirmDelete.confirm")}
          destructive
          pending={deleteTarget.isPending}
          error={deleteTarget.isError ? errorMessage(deleteTarget.error) : null}
          onCancel={closeDialog}
          onConfirm={() =>
            deleteTarget.mutate(
              { params: { path: { id: dialog.target.id } } },
              {
                onSuccess: () => {
                  toast.success(t("targets.toast.deleted"));
                  closeDialog();
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
