import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { usePipeline } from "@/features/pipelines/api/get-pipeline";
import { PipelineEditor } from "@/features/pipelines/components/pipeline-editor";
import { useWorkers } from "@/features/workers/api/get-workers";
import { useErrorMessage } from "@/hooks/use-error-message";

/** `/app/pipelines/new` and `/app/pipelines/:pipelineId`: the block builder. */
export function PipelineEditRoute() {
  const { pipelineId } = useParams();
  const { t } = useTranslation("pipelines");
  const errorMessage = useErrorMessage();
  const workers = useWorkers();
  const pipeline = usePipeline(pipelineId ?? "", { enabled: pipelineId !== undefined });

  const back = (
    <Link
      to="/app/pipelines"
      className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" />
      {t("editor.back")}
    </Link>
  );

  const loading = workers.isPending || (pipelineId !== undefined && pipeline.isPending);
  const error = workers.error ?? (pipelineId === undefined ? null : pipeline.error);

  return (
    <div className="grid gap-6">
      {back}
      <PageHeader
        title={pipelineId ? (pipeline.data?.name ?? "…") : t("editor.newTitle")}
        description={t("editor.subtitle")}
      />
      {error ? (
        <p role="alert" className="text-destructive">
          {errorMessage(error)}
        </p>
      ) : loading || !workers.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        // Keyed: a saved pipeline's id (after "create") starts a fresh form from the stored data.
        <PipelineEditor key={pipelineId ?? "new"} pipeline={pipeline.data} workers={workers.data.items} />
      )}
    </div>
  );
}
