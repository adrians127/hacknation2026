import { Copy, Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { Signature } from "@subsurf/contracts/signatures/signatures.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { GuardedButton } from "@/components/guarded-button";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteSignature } from "@/features/signatures/api/delete-signature";
import { useExportSignatures } from "@/features/signatures/api/export-signatures";
import { useSignatures } from "@/features/signatures/api/get-signatures";
import { useUpdateSignature } from "@/features/signatures/api/update-signature";
import { ImportSignaturesDialog } from "@/features/signatures/components/import-signatures-dialog";
import { SignatureFormDialog } from "@/features/signatures/components/signature-form-dialog";
import { SignatureSeverityBadge } from "@/features/signatures/components/signature-severity-badge";
import { SignatureSummary } from "@/features/signatures/components/signature-summary";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime } from "@/lib/format";

const column = createDataTableColumns<Signature>();
const KINDS = ["all", "custom", "builtIn"] as const;
type Kind = (typeof KINDS)[number];

type Editing = { signature: Signature | null; copy: boolean };

/** Built-in and custom detection signatures, with what each matched in the newest scan. */
export function SignaturesPanel() {
  const { t, i18n } = useTranslation("signatures");
  const errorMessage = useErrorMessage();
  const signatures = useSignatures();
  const { mutate: updateSignature, isPending: updating } = useUpdateSignature();
  const remove = useDeleteSignature();
  const exportSignatures = useExportSignatures();
  const canUpdate = useCan("signatures:update");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Signature | null>(null);
  const [importing, setImporting] = useState(false);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Kind>("all");

  const items = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (signatures.data?.items ?? []).filter(
      (signature) =>
        (kind === "all" || (kind === "builtIn") === signature.builtIn) &&
        (term === "" ||
          [signature.name, signature.product ?? "", signature.description, t(`categories.${signature.category}`)]
            .join(" ")
            .toLowerCase()
            .includes(term)),
    );
  }, [signatures.data, search, kind, t]);

  const columns = useMemo(() => {
    const toggle = (signature: Signature, enabled: boolean) =>
      updateSignature(
        { params: { path: { id: signature.id } }, body: { enabled } },
        { onError: (error) => toast.error(errorMessage(error)) },
      );

    return column.columns([
      column.accessor("name", {
        header: t("columns.name"),
        cell: ({ row: { original: signature } }) => (
          <div className="grid max-w-64 min-w-40 gap-1 whitespace-normal">
            <span className="font-medium">{signature.name}</span>
            <div className="flex flex-wrap gap-1">
              <Badge variant="outline">{t(`categories.${signature.category}`)}</Badge>
              {signature.builtIn && <Badge variant="secondary">{t("builtIn")}</Badge>}
            </div>
            {signature.description && (
              <span className="line-clamp-2 text-xs text-muted-foreground">{signature.description}</span>
            )}
          </div>
        ),
      }),
      column.accessor((signature) => signature.severity ?? "", {
        id: "severity",
        header: t("columns.severity"),
        cell: ({ row: { original: signature } }) => (
          <div className="grid justify-items-start gap-1">
            <SignatureSeverityBadge severity={signature.severity} />
            {signature.product && <span className="text-xs text-muted-foreground">{signature.product}</span>}
          </div>
        ),
      }),
      column.display({
        id: "definition",
        header: t("columns.conditions"),
        cell: ({ row: { original: signature } }) => <SignatureSummary definition={signature.definition} />,
      }),
      column.accessor((signature) => signature.hits?.hosts ?? -1, {
        id: "hits",
        header: t("columns.hits"),
        cell: ({ row: { original: signature } }) => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {!signature.enabled
              ? t("hits.off")
              : signature.hits === null
                ? t("hits.pending")
                : signature.hits.services === 0
                  ? t("hits.none")
                  : t("hits.value", { hosts: signature.hits.hosts, services: signature.hits.services })}
          </span>
        ),
      }),
      column.accessor("enabled", {
        header: t("columns.enabled"),
        enableSorting: false,
        cell: ({ row: { original: signature } }) => (
          <Checkbox
            checked={signature.enabled}
            disabled={!canUpdate || updating}
            aria-label={t("actions.toggle", { name: signature.name })}
            onCheckedChange={(checked) => toggle(signature, checked === true)}
          />
        ),
      }),
      column.display({
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row: { original: signature } }) => (
          <div className="flex justify-end gap-1">
            <IconAction
              label={t("actions.duplicate", { name: signature.name })}
              icon={<Copy />}
              permissions={["signatures:create"]}
              onClick={() => setEditing({ signature, copy: true })}
            />
            <IconAction
              label={t("actions.edit", { name: signature.name })}
              icon={<Pencil />}
              permissions={["signatures:update"]}
              disabledReason={signature.builtIn ? t("actions.builtInReadOnly") : undefined}
              onClick={() => setEditing({ signature, copy: false })}
            />
            <IconAction
              label={t("actions.delete", { name: signature.name })}
              icon={<Trash2 />}
              permissions={["signatures:delete"]}
              disabledReason={signature.builtIn ? t("actions.builtInReadOnly") : undefined}
              destructive
              onClick={() => setDeleting(signature)}
            />
          </div>
        ),
      }),
    ]);
  }, [t, updateSignature, updating, errorMessage, canUpdate]);

  const evaluation = signatures.data?.evaluation;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">{t("intro")}</p>
        <div className="flex flex-wrap gap-2">
          <GuardedButton
            variant="outline"
            permissions={["signatures:read"]}
            disabled={exportSignatures.isPending}
            onClick={() =>
              exportSignatures.mutate(undefined, {
                onSuccess: () => toast.success(t("toast.exported")),
                onError: (error) => toast.error(errorMessage(error)),
              })
            }
          >
            <Download />
            {t("actions.export")}
          </GuardedButton>
          <GuardedButton variant="outline" permissions={["signatures:create"]} onClick={() => setImporting(true)}>
            <Upload />
            {t("actions.import")}
          </GuardedButton>
          <GuardedButton
            permissions={["signatures:create"]}
            onClick={() => setEditing({ signature: null, copy: false })}
          >
            <Plus />
            {t("actions.add")}
          </GuardedButton>
        </div>
      </div>

      {evaluation && (
        <div className="grid gap-1 text-xs text-muted-foreground" aria-live="polite">
          <p>
            {evaluation.scan === null
              ? t("evaluation.noScan")
              : t("evaluation.newest", {
                  date: evaluation.scan.startedAt
                    ? formatDateTime(evaluation.scan.startedAt, i18n.language)
                    : evaluation.scan.id,
                })}
            {evaluation.pendingScans > 0 && ` ${t("evaluation.pending", { count: evaluation.pendingScans })}`}
          </p>
          {signatures.data && (
            <p>{t("evaluation.probePaths", { paths: signatures.data.probePaths.join(", ") })}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          className="max-w-xs"
          placeholder={t("filters.search")}
          aria-label={t("filters.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select value={kind} onValueChange={(value) => setKind(KINDS.find((option) => option === value) ?? "all")}>
          <SelectTrigger className="w-44" aria-label={t("filters.kind")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((option) => (
              <SelectItem key={option} value={option}>
                {t(`filters.kinds.${option}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {signatures.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : signatures.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(signatures.error)}
        </p>
      ) : (
        <Card>
          <CardContent>
            <DataTable columns={columns} data={items} emptyLabel={t("empty")} />
          </CardContent>
        </Card>
      )}

      {editing && (
        <SignatureFormDialog
          signature={editing.signature}
          copy={editing.copy}
          onClose={() => setEditing(null)}
        />
      )}
      {importing && <ImportSignaturesDialog onClose={() => setImporting(false)} />}
      {deleting && (
        <ConfirmDialog
          title={t("deleteTitle")}
          description={t("deleteDescription", { name: deleting.name })}
          confirmLabel={t("deleteTitle")}
          destructive
          pending={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : null}
          onCancel={() => {
            remove.reset();
            setDeleting(null);
          }}
          onConfirm={() =>
            remove.mutate(
              { params: { path: { id: deleting.id } } },
              {
                onSuccess: () => {
                  toast.success(t("toast.deleted"));
                  setDeleting(null);
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
