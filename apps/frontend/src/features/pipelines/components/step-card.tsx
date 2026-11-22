import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";

import { parseHostSelectors } from "@subsurf/contracts/hosts/host-selectors";
import { PIPELINE_BATCH_SIZES } from "@subsurf/contracts/pipelines/pipelines.schema";
import { validateStepParams, type SplitStrategy } from "@subsurf/contracts/workers/worker-catalog";
import type { Worker } from "@subsurf/contracts/workers/worker-registry.schema";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TargetPicker } from "@/features/pipelines/components/target-picker";
import { PORT_PRESET_KEYS, PORT_PRESETS, targetSelector, type StepDraft } from "@/features/pipelines/lib/draft";
import { WorkerParamInput } from "@/features/workers/components/worker-param-input";
import { cn } from "@/lib/utils";

const numberValue = (value: number) => (Number.isNaN(value) ? "" : value);
const parseNumber = (raw: string) => (raw === "" ? Number.NaN : Number(raw));

export interface StepCardProps {
  step: StepDraft;
  index: number;
  count: number;
  worker: Worker | undefined;
  /** Zod issue paths inside this step, e.g. `ports` or `split.maxTasks`. */
  invalidPaths: ReadonlySet<string>;
  showErrors: boolean;
  disabled: boolean;
  isDragTarget: boolean;
  onChange: (step: StepDraft) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

/**
 * One block of the pipeline: its worker, what it scans (its own targets or the previous step's
 * hits), and the job parameters the worker gets.
 */
export function StepCard({
  step,
  index,
  count,
  worker,
  invalidPaths,
  showErrors,
  disabled,
  isDragTarget,
  onChange,
  onMove,
  onRemove,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: StepCardProps) {
  const { t } = useTranslation("pipelines");
  const { t: tIssue } = useTranslation("pipelines", { keyPrefix: "paramIssues" });
  const id = `step-${step.key}`;
  const name = worker?.displayName ?? "?";
  const fields = worker?.paramFields ?? [];
  const paramIssues = new Map(validateStepParams(fields, step.params).map((issue) => [issue.key, issue.code]));
  const takes = (input: "targets" | "previous") =>
    worker?.inputs.includes(input === "targets" ? "targets" : "hosts") ?? false;

  const set = (patch: Partial<StepDraft>) => onChange({ ...step, ...patch });
  const invalid = (path: string, extra = false) => showErrors && (invalidPaths.has(path) || extra);
  const rateTooHigh = worker !== undefined && step.rate > worker.maxRate;
  const inputUnsupported = !takes(step.input) || (index === 0 && step.input === "previous");
  const splitUnsupported = worker !== undefined && !worker.splitStrategies.includes(step.split.strategy);
  const invalidRanges = parseHostSelectors(step.target.rangesText).invalid;
  const errorText = (on: boolean, fieldId: string) =>
    on ? (
      <p id={`${fieldId}-error`} className="text-sm text-destructive">
        {t("editor.invalidField")}
      </p>
    ) : null;

  const dragProps = {
    onDragEnter: (event: DragEvent) => {
      event.preventDefault();
      onDragEnter();
    },
    onDragOver: (event: DragEvent) => event.preventDefault(),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      onDrop();
    },
  };

  return (
    <Card className={cn(isDragTarget && "ring-2 ring-brand")} {...dragProps}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {!disabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    onDragStart();
                  }}
                  onDragEnd={onDragEnd}
                  className="cursor-grab text-muted-foreground"
                  aria-hidden
                >
                  <GripVertical className="size-4" />
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("editor.steps.dragHandle")}</TooltipContent>
            </Tooltip>
          )}
          <CardTitle className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">{t("editor.steps.step", { index: index + 1 })}</span>
            {name}
            {worker && <code className="text-xs font-normal text-muted-foreground">{worker.name}</code>}
          </CardTitle>
        </div>
        {!disabled && (
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("editor.steps.moveUp")}
              disabled={index === 0}
              onClick={() => onMove(index - 1)}
            >
              <ArrowUp />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("editor.steps.moveDown")}
              disabled={index === count - 1}
              onClick={() => onMove(index + 1)}
            >
              <ArrowDown />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              aria-label={t("editor.steps.remove")}
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {worker && !worker.enabled && (
          <p className="text-sm text-amber-400">
            {t("editor.steps.workerDisabled")}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-input`}>{t("editor.steps.input")}</Label>
            <Select
              value={step.input}
              disabled={disabled}
              onValueChange={(value) => set({ input: value === "previous" ? "previous" : "targets" })}
            >
              <SelectTrigger
                id={`${id}-input`}
                aria-invalid={invalid("input", inputUnsupported) || undefined}
                aria-describedby={invalid("input", inputUnsupported) ? `${id}-input-error` : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="targets" disabled={!takes("targets")}>
                  {t("editor.steps.inputs.targets")}
                </SelectItem>
                {index > 0 && (
                  <SelectItem value="previous" disabled={!takes("previous")}>
                    {t("editor.steps.inputs.previous", { index })}
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            {showErrors && inputUnsupported ? (
              <p id={`${id}-input-error`} className="text-sm text-destructive">
                {t("editor.steps.inputUnsupported", { worker: name })}
              </p>
            ) : (
              errorText(invalid("input"), `${id}-input`)
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-ports`}>{t("editor.steps.ports")}</Label>
            <Input
              id={`${id}-ports`}
              value={step.ports}
              disabled={disabled}
              className="font-mono text-xs"
              onChange={(event) => set({ ports: event.target.value.replaceAll(/\s+/g, "") })}
              aria-invalid={invalid("ports") || undefined}
              aria-describedby={`${id}-ports-hint`}
            />
            <div id={`${id}-ports-hint`} className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {t("editor.steps.portsHint")}
              {!disabled &&
                PORT_PRESET_KEYS.map((preset) => (
                  <Button
                    key={preset}
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => set({ ports: PORT_PRESETS[preset] })}
                  >
                    {t(`editor.steps.portPresets.${preset}`)}
                  </Button>
                ))}
            </div>
            {errorText(invalid("ports"), `${id}-ports`)}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-rate`}>{t("editor.steps.rate")}</Label>
            <Input
              id={`${id}-rate`}
              type="number"
              min={1}
              max={worker?.maxRate}
              value={numberValue(step.rate)}
              disabled={disabled}
              onChange={(event) => set({ rate: parseNumber(event.target.value) })}
              aria-invalid={invalid("rate", rateTooHigh) || undefined}
              aria-describedby={`${id}-rate-hint`}
            />
            {worker && (
              <p
                id={`${id}-rate-hint`}
                className={cn("text-xs", invalid("rate", rateTooHigh) ? "text-destructive" : "text-muted-foreground")}
              >
                {t("editor.steps.rateMax", { max: worker.maxRate })}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-batch`}>{t("editor.steps.batchSize")}</Label>
            <Select
              value={String(step.batchSize)}
              disabled={disabled}
              onValueChange={(value) => set({ batchSize: Number(value) })}
            >
              <SelectTrigger id={`${id}-batch`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PIPELINE_BATCH_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-duration`}>{t("editor.steps.maxDuration")}</Label>
            <Input
              id={`${id}-duration`}
              type="number"
              min={1}
              max={10_080}
              value={numberValue(step.maxDurationSeconds / 60)}
              disabled={disabled}
              onChange={(event) => set({ maxDurationSeconds: parseNumber(event.target.value) * 60 })}
              aria-invalid={invalid("maxDurationSeconds") || undefined}
            />
            {errorText(invalid("maxDurationSeconds"), `${id}-duration`)}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-split`}>{t("editor.steps.split")}</Label>
            <div className="flex gap-2">
              <Select
                value={step.split.strategy}
                disabled={disabled}
                onValueChange={(value) => {
                  const strategy = worker?.splitStrategies.find((option) => option === value);
                  if (strategy) set({ split: splitFor(strategy, step.split.maxTasks) });
                }}
              >
                <SelectTrigger id={`${id}-split`} aria-invalid={invalid("split", splitUnsupported) || undefined}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(worker?.splitStrategies ?? ["none"]).map((strategy) => (
                    <SelectItem key={strategy} value={strategy}>
                      {t(`editor.steps.splits.${strategy}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {step.split.strategy !== "none" && (
                <Input
                  type="number"
                  min={1}
                  max={64}
                  className="w-24"
                  aria-label={t("editor.steps.maxTasks")}
                  placeholder={t("editor.steps.maxTasks")}
                  value={step.split.maxTasks ?? ""}
                  disabled={disabled}
                  onChange={(event) =>
                    set({
                      split: splitFor(
                        step.split.strategy,
                        event.target.value === "" ? undefined : Number(event.target.value),
                      ),
                    })
                  }
                  aria-invalid={invalid("split.maxTasks") || undefined}
                />
              )}
            </div>
          </div>
        </div>

        {step.input === "targets" && (
          <fieldset className="grid gap-4 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("editor.targets.title")}</legend>
            <p className="text-xs text-muted-foreground">{t("editor.targets.hint")}</p>
            <div className="grid gap-1.5">
              <h4 className="text-sm font-medium">{t("editor.targets.select")}</h4>
              <p className="text-xs text-muted-foreground">{t("editor.targets.selectHint")}</p>
              <TargetPicker
                selector={targetSelector(step.target)}
                disabled={disabled}
                onChange={(selection) => set({ target: { ...step.target, ...selection } })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-ranges`}>{t("editor.targets.ranges")}</Label>
              <Textarea
                id={`${id}-ranges`}
                rows={2}
                className="font-mono text-xs"
                value={step.target.rangesText}
                placeholder={t("editor.targets.rangesPlaceholder")}
                disabled={disabled}
                onChange={(event) => set({ target: { ...step.target, rangesText: event.target.value } })}
                aria-invalid={invalidRanges.length > 0 || undefined}
                aria-describedby={`${id}-ranges-hint`}
              />
              <p
                id={`${id}-ranges-hint`}
                className={invalidRanges.length > 0 ? "text-sm text-destructive" : "text-xs text-muted-foreground"}
              >
                {invalidRanges.length > 0
                  ? t("editor.targets.rangesInvalid", { values: invalidRanges.slice(0, 5).join(", ") })
                  : t("editor.targets.rangesHint")}
              </p>
            </div>
            {errorText(invalid("targets"), `${id}-targets`)}
          </fieldset>
        )}

        {fields.length > 0 && (
          <fieldset className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{t("editor.steps.workerParams", { worker: name })}</legend>
            {fields.map((field) => {
              const issue = paramIssues.get(field.key);
              return (
                <WorkerParamInput
                  key={field.key}
                  id={`${id}-param-${field.key}`}
                  field={field}
                  value={step.params[field.key]}
                  disabled={disabled}
                  error={showErrors && issue ? tIssue(issue) : undefined}
                  onChange={(value) => {
                    const params = { ...step.params };
                    if (value === undefined) delete params[field.key];
                    else params[field.key] = value;
                    set({ params });
                  }}
                />
              );
            })}
          </fieldset>
        )}
        {worker && invalidPaths.has("params") && showErrors && paramIssues.size === 0 && (
          <Badge variant="destructive">{t("editor.invalidField")}</Badge>
        )}
      </CardContent>
    </Card>
  );
}

function splitFor(strategy: SplitStrategy, maxTasks: number | undefined): StepDraft["split"] {
  return strategy === "none" || maxTasks === undefined ? { strategy } : { strategy, maxTasks };
}
