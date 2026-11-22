import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePipelines } from "@/features/pipelines/api/get-pipelines";
import { useRunPipeline } from "@/features/pipelines/api/run-pipeline";
import { useScheduleSummary, useTargetsSummary } from "@/features/pipelines/lib/summaries";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";

/** "Start scan" on the scans page: run a pipeline now, or go import targets. */
export function StartScanDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("pipelines");
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const pipelines = usePipelines();
  const runPipeline = useRunPipeline();
  const canCreatePipelines = useCan("pipelines:create");
  const canImport = useCan("targets:create");
  const scheduleSummary = useScheduleSummary();
  const targetsSummary = useTargetsSummary();
  const [pipelineId, setPipelineId] = useState<string>("");

  const items = pipelines.data?.items ?? [];
  const selected = items.find((pipeline) => pipeline.id === pipelineId);

  function start() {
    if (!selected) return;
    runPipeline.mutate(
      { params: { path: { id: selected.id } } },
      {
        onSuccess: ({ scan }) => {
          toast.success(t("list.toast.started", { count: scan.jobCount }));
          onClose();
          void navigate(`/app/scans/${scan.id}`);
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("startDialog.title")}</DialogTitle>
          <DialogDescription>{t("startDialog.description")}</DialogDescription>
        </DialogHeader>

        {pipelines.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("startDialog.none")}</p>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor="start-pipeline">{t("startDialog.pipeline")}</Label>
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger id="start-pipeline">
                <SelectValue placeholder={t("startDialog.pickPipeline")} />
              </SelectTrigger>
              <SelectContent>
                {items.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id} disabled={pipeline.activeRun !== null}>
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-sm text-muted-foreground">
                {selected.steps.map((step) => step.worker.displayName).join(" → ")} ·{" "}
                {targetsSummary(selected.steps)} · {scheduleSummary(selected.schedule)}
              </p>
            )}
          </div>
        )}

        {runPipeline.isError && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(runPipeline.error)}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {canCreatePipelines && (
              <Button asChild variant="ghost">
                <Link to="/app/pipelines/new">{t("startDialog.create")}</Link>
              </Button>
            )}
            {canImport && (
              <Button asChild variant="ghost">
                <Link to="/app/targets/new">{t("startDialog.import")}</Link>
              </Button>
            )}
          </div>
          <Button onClick={start} disabled={!selected || runPipeline.isPending}>
            {t(runPipeline.isPending ? "startDialog.starting" : "startDialog.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
