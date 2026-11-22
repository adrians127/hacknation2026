import { ArrowDown, Play, Plus, Save } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { parseHostSelectors } from "@subsurf/contracts/hosts/host-selectors";
import {
  PIPELINE_MAX_STEPS,
  PipelineBodySchema,
  type PipelineDetail,
} from "@subsurf/contracts/pipelines/pipelines.schema";
import { validateStepParams } from "@subsurf/contracts/workers/worker-catalog";
import type { Worker } from "@subsurf/contracts/workers/worker-registry.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { GuardedButton } from "@/components/guarded-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCreatePipeline } from "@/features/pipelines/api/create-pipeline";
import { useRunPipeline } from "@/features/pipelines/api/run-pipeline";
import { useUpdatePipeline } from "@/features/pipelines/api/update-pipeline";
import { ScheduleFields } from "@/features/pipelines/components/schedule-fields";
import { StepCard } from "@/features/pipelines/components/step-card";
import {
  draftFromPipeline,
  draftToBody,
  emptyDraft,
  moveItem,
  newStep,
  type PipelineDraft,
  type StepDraft,
} from "@/features/pipelines/lib/draft";
import { SCAN_STATUS_VARIANT } from "@/features/scans/lib/status";
import { useLeaveGuard } from "@/features/targets/hooks/use-leave-guard";
import { useErrorMessage } from "@/hooks/use-error-message";
import { toApiError } from "@/lib/api-error";
import { useBlockedReason } from "@/lib/auth/use-blocked-reason";
import { formatDateTime } from "@/lib/format";

function stepIsRunnable(step: StepDraft, index: number, worker: Worker | undefined): boolean {
  if (!worker) return false;
  const input = step.input === "targets" ? "targets" : "hosts";
  return (
    worker.inputs.includes(input) &&
    (index > 0 || step.input === "targets") &&
    step.rate <= worker.maxRate &&
    worker.splitStrategies.includes(step.split.strategy) &&
    validateStepParams(worker.paramFields, step.params).length === 0 &&
    (step.input !== "targets" || parseHostSelectors(step.target.rangesText).invalid.length === 0)
  );
}

/** Issue paths under `prefix`, without it: `steps.1.ports` → `ports` for step 1. */
function pathsUnder(paths: readonly string[], prefix: string): Set<string> {
  return new Set(paths.filter((path) => path.startsWith(`${prefix}.`)).map((path) => path.slice(prefix.length + 1)));
}

/**
 * Creates or edits a pipeline: an ordered chain of worker blocks, each with its own targets or
 * the previous block's hits, and a schedule.
 * Without `pipelines:update` (or `create` for a new one) it is read-only; without `scans:run`
 * the schedule stays as it is.
 */
export function PipelineEditor({ pipeline, workers }: { pipeline?: PipelineDetail; workers: Worker[] }) {
  const { t, i18n } = useTranslation("pipelines");
  const { t: tc } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const editBlocked = useBlockedReason([pipeline ? "pipelines:update" : "pipelines:create"]);
  const scheduleBlocked = useBlockedReason(["scans:run"]);
  const canEdit = editBlocked === undefined;
  const createPipeline = useCreatePipeline();
  const updatePipeline = useUpdatePipeline();
  const runPipeline = useRunPipeline();
  const save = pipeline ? updatePipeline : createPipeline;

  const [initial, setInitial] = useState<PipelineDraft>(() =>
    pipeline ? draftFromPipeline(pipeline) : emptyDraft(workers),
  );
  const [draft, setDraft] = useState<PipelineDraft>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const body = useMemo(() => draftToBody(draft), [draft]);
  const isDirty = useMemo(() => JSON.stringify(body) !== JSON.stringify(draftToBody(initial)), [body, initial]);
  const blocker = useLeaveGuard(canEdit && isDirty);

  // Navigate once the saved draft has rendered as clean, so the leave guard lets it through.
  useEffect(() => {
    if (createdId && !isDirty) void navigate(`/app/pipelines/${createdId}`, { replace: true });
  }, [createdId, isDirty, navigate]);

  const workerById = useMemo(() => new Map(workers.map((worker) => [worker.id, worker])), [workers]);
  const enabledWorkers = workers.filter((worker) => worker.enabled);
  const parsed = PipelineBodySchema.safeParse(body);
  const issuePaths = parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
  const stepsRunnable = draft.steps.every((step, index) => stepIsRunnable(step, index, workerById.get(step.workerId)));
  const isValid = parsed.success && stepsRunnable;
  const invalid = (path: string) => (showErrors && issuePaths.includes(path)) || undefined;

  const setDraftField = <K extends keyof PipelineDraft>(key: K, value: PipelineDraft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const setSteps = (update: (steps: StepDraft[]) => StepDraft[]) =>
    setDraft((previous) => ({ ...previous, steps: update(previous.steps) }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (!isValid || !canEdit) return;
    const onSuccess = (saved: { id: string }) => {
      toast.success(t(pipeline ? "editor.saved" : "editor.created"));
      setInitial(draft);
      setShowErrors(false);
      if (!pipeline) setCreatedId(saved.id);
    };
    if (pipeline) {
      updatePipeline.mutate({ params: { path: { id: pipeline.id } }, body }, { onSuccess });
    } else {
      createPipeline.mutate({ body }, { onSuccess });
    }
  }

  function runNow() {
    if (!pipeline) return;
    runPipeline.mutate(
      { params: { path: { id: pipeline.id } } },
      {
        onSuccess: ({ scan }) => {
          toast.success(t("list.toast.started", { count: scan.jobCount }));
          void navigate(`/app/scans/${scan.id}`);
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  const saveError = save.isError ? toApiError(save.error) : null;
  const runBlocked = isDirty
    ? t("editor.unsaved")
    : pipeline?.activeRun
      ? t("list.runActive")
      : undefined;

  return (
    <div className="grid gap-6">
      {!canEdit && <p className="text-sm text-muted-foreground">{t("editor.readOnly")}</p>}

      <form id="pipeline-form" onSubmit={submit} noValidate className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("editor.general.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pipeline-name">{t("editor.general.name")}</Label>
              <Input
                id="pipeline-name"
                value={draft.name}
                maxLength={100}
                disabled={!canEdit}
                onChange={(event) => setDraftField("name", event.target.value)}
                aria-invalid={invalid("name")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pipeline-description">{t("editor.general.description")}</Label>
              <Input
                id="pipeline-description"
                value={draft.description}
                maxLength={1000}
                disabled={!canEdit}
                onChange={(event) => setDraftField("description", event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("editor.steps.title")}</CardTitle>
            <CardDescription>{t("editor.steps.hint")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {canEdit && (
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t("editor.steps.add")}</p>
                {enabledWorkers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("editor.steps.noWorkers")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {enabledWorkers.map((worker) => (
                      <Tooltip key={worker.id}>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={draft.steps.length >= PIPELINE_MAX_STEPS}
                            onClick={() => setSteps((steps) => [...steps, newStep(worker, steps.at(-1))])}
                          >
                            <Plus />
                            {worker.displayName}
                          </Button>
                        </TooltipTrigger>
                        {worker.description && <TooltipContent className="max-w-xs">{worker.description}</TooltipContent>}
                      </Tooltip>
                    ))}
                  </div>
                )}
              </div>
            )}

            {draft.steps.length === 0 ? (
              <p className={showErrors ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                {t("editor.steps.empty")}
              </p>
            ) : (
              <ol className="grid gap-2" aria-label={t("editor.steps.title")}>
                {draft.steps.map((step, index) => {
                  const next = draft.steps[index + 1];
                  return (
                    <Fragment key={step.key}>
                      <li>
                        <StepCard
                          step={step}
                          index={index}
                          count={draft.steps.length}
                          worker={workerById.get(step.workerId)}
                          invalidPaths={pathsUnder(issuePaths, `steps.${index}`)}
                          showErrors={showErrors}
                          disabled={!canEdit}
                          isDragTarget={dragFrom !== null && dragOver === index && dragFrom !== index}
                          onChange={(changed) =>
                            setSteps((steps) => steps.map((existing) => (existing.key === changed.key ? changed : existing)))
                          }
                          onMove={(to) => setSteps((steps) => moveItem(steps, index, to))}
                          onRemove={() => setSteps((steps) => steps.filter((existing) => existing.key !== step.key))}
                          onDragStart={() => setDragFrom(index)}
                          onDragEnter={() => setDragOver(index)}
                          onDrop={() => {
                            if (dragFrom !== null) setSteps((steps) => moveItem(steps, dragFrom, index));
                            setDragFrom(null);
                            setDragOver(null);
                          }}
                          onDragEnd={() => {
                            setDragFrom(null);
                            setDragOver(null);
                          }}
                        />
                      </li>
                      {next && (
                        <li
                          aria-hidden
                          className="flex items-center gap-2 pl-6 text-xs text-muted-foreground"
                        >
                          <ArrowDown className="size-4" />
                          {t(next.input === "previous" ? "editor.steps.flow.previous" : "editor.steps.flow.targets")}
                        </li>
                      )}
                    </Fragment>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("editor.schedule.title")}</CardTitle>
            <CardDescription>{t("editor.schedule.hint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ScheduleFields
              schedule={draft.schedule}
              enabled={draft.enabled}
              onScheduleChange={(schedule) => setDraftField("schedule", schedule)}
              onEnabledChange={(enabled) => setDraftField("enabled", enabled)}
              invalidPaths={pathsUnder(issuePaths, "schedule")}
              showErrors={showErrors}
              disabled={!canEdit || scheduleBlocked !== undefined}
              disabledReason={canEdit ? scheduleBlocked : undefined}
            />
          </CardContent>
        </Card>

        {showErrors && !isValid && (
          <p role="alert" className="text-sm text-destructive">
            {t("editor.invalid")}
          </p>
        )}
        {saveError && (
          <div role="alert" className="grid gap-1 text-sm text-destructive">
            <p>{errorMessage(save.error)}</p>
            {saveError.status === 400 && !saveError.code && (
              <p className="text-muted-foreground">{t("editor.serverDetail", { message: saveError.message })}</p>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {pipeline && (
            <GuardedButton
              type="button"
              variant="outline"
              permissions={["scans:run"]}
              disabledReason={runBlocked}
              disabled={runPipeline.isPending}
              onClick={runNow}
            >
              <Play />
              {t("editor.runNow")}
            </GuardedButton>
          )}
          {canEdit && (
            <Button type="submit" disabled={save.isPending || (showErrors && !isValid)}>
              <Save />
              {t(save.isPending ? "editor.saving" : "editor.save")}
            </Button>
          )}
        </div>
      </form>

      {pipeline && (
        <Card>
          <CardHeader>
            <CardTitle>{t("editor.runs.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {pipeline.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("editor.runs.empty")}</p>
            ) : (
              <ul className="grid gap-2">
                {pipeline.runs.map((run) => (
                  <li key={run.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <Link to={`/app/scans/${run.id}`} className="font-medium hover:underline">
                      {formatDateTime(run.startedAt ?? run.createdAt, locale)}
                    </Link>
                    <Badge variant={SCAN_STATUS_VARIANT[run.status]}>{tc(`scans.statuses.${run.status}`)}</Badge>
                    <span className="text-muted-foreground">{tc(`scans.triggers.${run.trigger}`)}</span>
                    <span className="text-muted-foreground">{t("editor.runs.jobs", { count: run.jobCount })}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {blocker.state === "blocked" && (
        <ConfirmDialog
          title={t("editor.leave.title")}
          description={t("editor.leave.description")}
          confirmLabel={t("editor.leave.confirm")}
          destructive
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  );
}
