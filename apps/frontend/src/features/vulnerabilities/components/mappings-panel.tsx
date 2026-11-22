import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { PackageMapping } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { GuardedButton } from "@/components/guarded-button";
import { IconAction } from "@/components/icon-action";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteMapping } from "@/features/vulnerabilities/api/delete-mapping";
import { usePackageMappings } from "@/features/vulnerabilities/api/get-mappings";
import { MappingFormDialog } from "@/features/vulnerabilities/components/mapping-form-dialog";
import { useErrorMessage } from "@/hooks/use-error-message";
import { createDataTableColumns } from "@/lib/data-table";

const column = createDataTableColumns<PackageMapping>();
const cpeOf = (mapping: PackageMapping) => `${mapping.cpeVendor}:${mapping.cpeProduct}`;

/** Which package a CPE product is in each ecosystem: what lets OSV data reach scanned services. */
export function MappingsPanel() {
  const { t } = useTranslation("vulnerabilities");
  const errorMessage = useErrorMessage();
  const mappings = usePackageMappings();
  const remove = useDeleteMapping();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<PackageMapping | null>(null);

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor(cpeOf, {
          id: "cpe",
          header: t("mappings.cpe"),
          cell: ({ getValue }) => <span className="font-mono">{getValue()}</span>,
        }),
        column.accessor("ecosystem", { header: t("mappings.ecosystem") }),
        column.accessor("packageName", {
          header: t("mappings.package"),
          cell: ({ getValue }) => <span className="font-mono break-all">{getValue()}</span>,
        }),
        column.accessor((mapping) => mapping.createdBy?.displayName ?? t("mappings.migration"), {
          id: "createdBy",
          header: t("mappings.addedBy"),
          cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("mappings.delete", { name: "" })}</span>,
          cell: ({ row: { original: mapping } }) => (
            <div className="flex justify-end">
              <IconAction
                label={t("mappings.delete", { name: `${cpeOf(mapping)} → ${mapping.packageName}` })}
                icon={<Trash2 />}
                permissions={["vulnerabilities:delete"]}
                destructive
                onClick={() => setDeleting(mapping)}
              />
            </div>
          ),
        }),
      ]),
    [t],
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">{t("mappings.description")}</p>
        <GuardedButton permissions={["vulnerabilities:create"]} onClick={() => setAdding(true)}>
          <Plus />
          {t("mappings.add")}
        </GuardedButton>
      </div>
      {mappings.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : mappings.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(mappings.error)}
        </p>
      ) : (
        <Card>
          <CardContent>
            <DataTable columns={columns} data={mappings.data.items} emptyLabel={t("mappings.empty")} />
          </CardContent>
        </Card>
      )}

      {adding && mappings.data && (
        <MappingFormDialog ecosystems={mappings.data.ecosystems} onClose={() => setAdding(false)} />
      )}
      {deleting && (
        <ConfirmDialog
          title={t("mappings.deleteTitle")}
          description={t("mappings.deleteDescription", {
            cpe: cpeOf(deleting),
            ecosystem: deleting.ecosystem,
            package: deleting.packageName,
          })}
          confirmLabel={t("mappings.deleteTitle")}
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
                  toast.success(t("toast.mappingRemoved"));
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
