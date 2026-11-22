import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { WORKER_MAX_RATE_LIMIT } from "@subsurf/contracts/workers/worker-catalog";
import type { Worker } from "@subsurf/contracts/workers/worker-registry.schema";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateWorker } from "@/features/workers/api/update-worker";
import { useErrorMessage } from "@/hooks/use-error-message";

/** Edits how a worker is shown and its rate cap; its capabilities come from the managers. */
export function WorkerEditDialog({ worker, onClose }: { worker: Worker; onClose: () => void }) {
  const { t } = useTranslation("pipelines");
  const errorMessage = useErrorMessage();
  const update = useUpdateWorker();

  const [displayName, setDisplayName] = useState(worker.displayName);
  const [description, setDescription] = useState(worker.description);
  const [maxRate, setMaxRate] = useState(String(worker.maxRate));
  const [submitted, setSubmitted] = useState(false);

  const rate = Number(maxRate);
  const isNameValid = /\S/.test(displayName);
  const isRateValid = maxRate.trim() !== "" && Number.isInteger(rate) && rate >= 1 && rate <= WORKER_MAX_RATE_LIMIT;
  const isValid = isNameValid && isRateValid;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!isValid) return;
    update.mutate(
      {
        params: { path: { id: worker.id } },
        body: { displayName: displayName.trim(), description: description.trim(), maxRate: rate },
      },
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
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("workers.edit.title", { name: worker.displayName })}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="worker-name">{t("workers.edit.displayName")}</Label>
            <Input
              id="worker-name"
              value={displayName}
              maxLength={100}
              onChange={(event) => setDisplayName(event.target.value)}
              aria-invalid={submitted && !isNameValid ? true : undefined}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="worker-description">{t("workers.edit.descriptionField")}</Label>
            <Textarea
              id="worker-description"
              rows={3}
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
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
