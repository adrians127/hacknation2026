import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { Worker } from "@subsurf/contracts/workers/worker-registry.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteWorker } from "@/features/workers/api/delete-worker";
import { useWorkers } from "@/features/workers/api/get-workers";
import { ManagersTable } from "@/features/workers/components/managers-table";
import { WorkerEditDialog } from "@/features/workers/components/worker-edit-dialog";
import { WorkersTable } from "@/features/workers/components/workers-table";
import { useErrorMessage } from "@/hooks/use-error-message";

type Dialog = { kind: "edit"; worker: Worker } | { kind: "delete"; worker: Worker };

export function WorkersRoute() {
  const { t } = useTranslation("pipelines");
  const errorMessage = useErrorMessage();
  const workers = useWorkers({ live: true });
  const deleteWorker = useDeleteWorker();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  const close = () => {
    deleteWorker.reset();
    setDialog(null);
  };

  return (
    <div className="grid gap-6">
      <PageHeader title={t("workers.title")} description={t("workers.subtitle")} />

      {workers.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : workers.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(workers.error)}
        </p>
      ) : (
        <>
          <Card>
            <CardContent>
              <WorkersTable
                workers={workers.data.items}
                onEdit={(worker) => setDialog({ kind: "edit", worker })}
                onDelete={(worker) => setDialog({ kind: "delete", worker })}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("workers.managers.title")}</CardTitle>
              <CardDescription>{t("workers.managers.subtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              {workers.data.managers.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("workers.managers.empty")}</p>
              ) : (
                <ManagersTable managers={workers.data.managers} />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {dialog?.kind === "edit" && <WorkerEditDialog worker={dialog.worker} onClose={close} />}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={t("workers.delete.title", { name: dialog.worker.displayName })}
          description={t("workers.delete.description")}
          confirmLabel={t("workers.delete.confirm")}
          destructive
          pending={deleteWorker.isPending}
          error={deleteWorker.isError ? errorMessage(deleteWorker.error) : null}
          onCancel={close}
          onConfirm={() =>
            deleteWorker.mutate(
              { params: { path: { id: dialog.worker.id } } },
              {
                onSuccess: () => {
                  toast.success(t("workers.toast.deleted"));
                  close();
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
