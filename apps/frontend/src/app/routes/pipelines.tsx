import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type { Pipeline } from "@subsurf/contracts/pipelines/pipelines.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { GuardedButton } from "@/components/guarded-button";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeletePipeline } from "@/features/pipelines/api/delete-pipeline";
import { usePipelines } from "@/features/pipelines/api/get-pipelines";
import { useRunPipeline } from "@/features/pipelines/api/run-pipeline";
import { useUpdatePipeline } from "@/features/pipelines/api/update-pipeline";
import { PipelinesTable } from "@/features/pipelines/components/pipelines-table";
import { useErrorMessage } from "@/hooks/use-error-message";

export function PipelinesRoute() {
  const { t } = useTranslation("pipelines");
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const pipelines = usePipelines();
  const runPipeline = useRunPipeline();
  const updatePipeline = useUpdatePipeline();
  const deletePipeline = useDeletePipeline();
  const [deleting, setDeleting] = useState<Pipeline | null>(null);

  const run = useCallback(
    (pipeline: Pipeline) =>
      runPipeline.mutate(
        { params: { path: { id: pipeline.id } } },
        {
          onSuccess: ({ scan }) => {
            toast.success(t("list.toast.started", { count: scan.jobCount }));
            void navigate(`/app/scans/${scan.id}`);
          },
          onError: (error) => toast.error(errorMessage(error)),
        },
      ),
    [runPipeline, navigate, t, errorMessage],
  );

  const toggleSchedule = useCallback(
    (pipeline: Pipeline) =>
      updatePipeline.mutate(
        { params: { path: { id: pipeline.id } }, body: { enabled: !pipeline.enabled } },
        {
          onSuccess: (saved) => toast.success(t(saved.enabled ? "list.toast.enabled" : "list.toast.disabled")),
          onError: (error) => toast.error(errorMessage(error)),
        },
      ),
    [updatePipeline, t, errorMessage],
  );

  const closeDelete = () => {
    deletePipeline.reset();
    setDeleting(null);
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title={t("list.title")}
        description={t("list.subtitle")}
        actions={
          <GuardedButton permissions={["pipelines:create"]} onClick={() => void navigate("/app/pipelines/new")}>
            <Plus />
            {t("list.new")}
          </GuardedButton>
        }
      />

      {pipelines.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : pipelines.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(pipelines.error)}
        </p>
      ) : (
        <Card>
          <CardContent>
            {pipelines.data.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("list.empty")}</p>
            ) : (
              <PipelinesTable
                pipelines={pipelines.data.items}
                onRun={run}
                onToggleSchedule={toggleSchedule}
                onDelete={setDeleting}
              />
            )}
          </CardContent>
        </Card>
      )}

      {deleting && (
        <ConfirmDialog
          title={t("list.delete.title", { name: deleting.name })}
          description={t("list.delete.description")}
          confirmLabel={t("list.delete.confirm")}
          destructive
          pending={deletePipeline.isPending}
          error={deletePipeline.isError ? errorMessage(deletePipeline.error) : null}
          onCancel={closeDelete}
          onConfirm={() =>
            deletePipeline.mutate(
              { params: { path: { id: deleting.id } } },
              {
                onSuccess: () => {
                  toast.success(t("list.toast.deleted"));
                  closeDelete();
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
