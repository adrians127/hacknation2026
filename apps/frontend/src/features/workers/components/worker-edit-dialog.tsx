import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  SplitStrategySchema,
  validateStepParams,
  WORKER_MAX_RATE_LIMIT,
  WorkerInputSchema,
  WorkerParamFieldsSchema,
  type SplitStrategy,
  type WorkerInput,
  type WorkerParamField,
  type WorkerParams,
  type WorkerParamValue,
} from "@subsurf/contracts/workers/worker-catalog";
import type { UpdateWorkerBody, Worker } from "@subsurf/contracts/workers/worker-registry.schema";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateWorker } from "@/features/workers/api/update-worker";
import { WorkerParamInput } from "@/features/workers/components/worker-param-input";
import { useErrorMessage } from "@/hooks/use-error-message";

function parseFields(text: string): WorkerParamField[] | null {
  try {
    const parsed = WorkerParamFieldsSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function withoutUnset(params: Record<string, WorkerParamValue | undefined>): WorkerParams {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, WorkerParamValue] => entry[1] !== undefined),
  );
}

function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? [...new Set([...list, item])] : list.filter((existing) => existing !== item);
}

export function WorkerEditDialog({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const { t } = useTranslation("pipelines");
  const { t: tParams } = useTranslation("pipelines", { keyPrefix: "paramIssues" });
  const errorMessage = useErrorMessage();
  const update = useUpdateWorker();
  const isCustom = !worker.isBuiltin;

  const [enabled, setEnabled] = useState(worker.enabled);
  const [maxRate, setMaxRate] = useState(String(worker.maxRate));
  const [defaults, setDefaults] = useState<Record<string, WorkerParamValue | undefined>>(worker.defaults);
  const [displayName, setDisplayName] = useState(worker.displayName);
  const [description, setDescription] = useState(worker.description);
  const [stage, setStage] = useState(String(worker.stage));
  const [inputs, setInputs] = useState<WorkerInput[]>(worker.inputs);
  const [splits, setSplits] = useState<SplitStrategy[]>(worker.splitStrategies);
  const [fieldsText, setFieldsText] = useState(() => JSON.stringify(worker.paramFields, null, 2));
  const [submitted, setSubmitted] = useState(false);

  const fields = isCustom ? parseFields(fieldsText) : worker.paramFields;
  const issues = useMemo(
    () => new Map(validateStepParams(fields ?? [], withoutUnset(defaults)).map((issue) => [issue.key, issue.code])),
    [fields, defaults],
  );
  const rate = Number(maxRate);
  const isRateValid = Number.isInteger(rate) && rate >= 1 && rate <= WORKER_MAX_RATE_LIMIT;
  const isStageValid = Number.isInteger(Number(stage)) && stage.trim() !== "";
  const isValid =
    isRateValid &&
    issues.size === 0 &&
    (!isCustom || (fields !== null && isStageValid && /\S/.test(displayName) && inputs.length > 0 && splits.length > 0));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!isValid) return;
    const body: UpdateWorkerBody = { enabled, maxRate: rate, defaults: withoutUnset(defaults) };
    if (isCustom && fields) {
      Object.assign(body, {
        displayName: displayName.trim(),
        description: description.trim(),
        stage: Number(stage),
        inputs,
        splitStrategies: splits,
        paramFields: fields,
      });
    }
    update.mutate(
      { params: { path: { id: worker.id } }, body },
      {
        onSuccess: () => {
          toast.success(t("workers.toast.saved"));
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("workers.edit.title", { name: worker.displayName })}</DialogTitle>
            {worker.isBuiltin && <DialogDescription>{t("workers.edit.description")}</DialogDescription>}
          </DialogHeader>

          <div className="flex items-start gap-3">
            <Checkbox id="worker-enabled" checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
            <Label htmlFor="worker-enabled">{t("workers.edit.enabled")}</Label>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="worker-max-rate">{t("workers.edit.maxRate")}</Label>
            <Input
              id="worker-max-rate"
              type="number"
              min={1}
              max={WORKER_MAX_RATE_LIMIT}
              value={maxRate}
              onChange={(event) => setMaxRate(event.target.value)}
              aria-invalid={submitted && !isRateValid ? true : undefined}
              aria-describedby="worker-max-rate-hint"
            />
            <p id="worker-max-rate-hint" className="text-xs text-muted-foreground">
              {t("workers.edit.maxRateHint")}
            </p>
          </div>

          {isCustom && (
            <>
              <div className="grid gap-1.5">
                <Label htmlFor="worker-name">{t("workers.edit.displayName")}</Label>
                <Input id="worker-name" value={displayName} maxLength={100} onChange={(event) => setDisplayName(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="worker-description">{t("workers.edit.descriptionField")}</Label>
                <Input
                  id="worker-description"
                  value={description}
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="worker-stage">{t("workers.edit.stage")}</Label>
                <Input
                  id="worker-stage"
                  type="number"
                  min={0}
                  max={1000}
                  value={stage}
                  onChange={(event) => setStage(event.target.value)}
                  aria-describedby="worker-stage-hint"
                />
                <p id="worker-stage-hint" className="text-xs text-muted-foreground">
                  {t("workers.edit.stageHint")}
                </p>
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t("workers.edit.inputs")}</legend>
                {WorkerInputSchema.options.map((input) => (
                  <div key={input} className="flex items-center gap-2">
                    <Checkbox
                      id={`worker-input-${input}`}
                      checked={inputs.includes(input)}
                      onCheckedChange={(checked) => setInputs(toggle(inputs, input, checked === true))}
                    />
                    <Label htmlFor={`worker-input-${input}`}>{t(`workers.inputs.${input}`)}</Label>
                  </div>
                ))}
              </fieldset>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">{t("workers.edit.splits")}</legend>
                {SplitStrategySchema.options.map((strategy) => (
                  <div key={strategy} className="flex items-center gap-2">
                    <Checkbox
                      id={`worker-split-${strategy}`}
                      checked={splits.includes(strategy)}
                      onCheckedChange={(checked) => setSplits(toggle(splits, strategy, checked === true))}
                    />
                    <Label htmlFor={`worker-split-${strategy}`}>{t(`editor.steps.splits.${strategy}`)}</Label>
                  </div>
                ))}
              </fieldset>
              <div className="grid gap-1.5">
                <Label htmlFor="worker-fields">{t("workers.edit.fields")}</Label>
                <Textarea
                  id="worker-fields"
                  rows={6}
                  className="font-mono text-xs"
                  value={fieldsText}
                  onChange={(event) => setFieldsText(event.target.value)}
                  aria-invalid={fields === null ? true : undefined}
                  aria-describedby="worker-fields-hint"
                />
                <p
                  id="worker-fields-hint"
                  className={fields === null ? "text-sm text-destructive" : "text-xs text-muted-foreground"}
                >
                  {t(fields === null ? "workers.edit.fieldsInvalid" : "workers.edit.fieldsHint")}
                </p>
              </div>
            </>
          )}

          {fields && fields.length > 0 && (
            <fieldset className="grid gap-3">
              <legend className="mb-1 text-sm font-medium">{t("workers.edit.defaults")}</legend>
              {fields.map((field) => {
                const issue = issues.get(field.key);
                return (
                  <WorkerParamInput
                    key={field.key}
                    id={`worker-default-${field.key}`}
                    field={field}
                    value={defaults[field.key]}
                    onChange={(value) => setDefaults((previous) => ({ ...previous, [field.key]: value }))}
                    error={issue ? tParams(issue) : undefined}
                  />
                );
              })}
            </fieldset>
          )}

          {update.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(update.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={update.isPending || (submitted && !isValid)}>
              {t(update.isPending ? "workers.edit.saving" : "workers.edit.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
