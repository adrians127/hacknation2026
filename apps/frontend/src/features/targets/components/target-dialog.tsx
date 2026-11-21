import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  CreateTargetBodySchema,
  UpdateTargetBodySchema,
  type Target,
} from "@hacknation/contracts/targets/targets.schema";

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
import { useCreateTarget } from "@/features/targets/api/create-target";
import { useUpdateTarget } from "@/features/targets/api/update-target";
import { useErrorMessage } from "@/hooks/use-error-message";

type Field = "value" | "note" | "tags";

const parseTags = (raw: string) =>
  raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

interface TargetDialogProps {
  /** Edits this target (only its note and tags); adds a new one when absent. */
  target?: Target;
  onClose: () => void;
}

export function TargetDialog({ target, onClose }: TargetDialogProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const createTarget = useCreateTarget();
  const updateTarget = useUpdateTarget();
  const mutation = target ? updateTarget : createTarget;

  const [value, setValue] = useState(target?.value ?? "");
  const [note, setNote] = useState(target?.note ?? "");
  const [tags, setTags] = useState(target?.tags.join(", ") ?? "");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  // A field's error disappears as soon as it is edited.
  const edit = (field: Field, set: (next: string) => void) => (next: string) => {
    set(next);
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = { note: note.trim(), tags: parseTags(tags) };
    const parsed = target
      ? UpdateTargetBodySchema.safeParse(fields)
      : CreateTargetBodySchema.safeParse({ ...fields, value: value.trim() });
    if (!parsed.success) {
      const invalid = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        value: invalid.has("value") ? t("targets.form.valueRequired") : undefined,
        note: invalid.has("note") ? t("targets.form.noteTooLong") : undefined,
        tags: invalid.has("tags") ? t("targets.form.tagsInvalid") : undefined,
      });
      return;
    }
    setErrors({});

    if (target) {
      updateTarget.mutate(
        { params: { path: { id: target.id } }, body: fields },
        {
          onSuccess: () => {
            toast.success(t("targets.toast.updated"));
            onClose();
          },
        },
      );
    } else {
      createTarget.mutate(
        { body: { ...fields, value: value.trim() } },
        {
          onSuccess: () => {
            toast.success(t("targets.toast.created"));
            onClose();
          },
        },
      );
    }
  }

  const fieldError = (name: Field) =>
    errors[name] && (
      <p id={`target-${name}-error`} className="text-sm text-destructive">
        {errors[name]}
      </p>
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{target ? t("targets.form.editTitle") : t("targets.form.createTitle")}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="target-value">{t("targets.form.value")}</Label>
            <Input
              id="target-value"
              value={value}
              disabled={Boolean(target)}
              placeholder={t("targets.form.valuePlaceholder")}
              onChange={(event) => edit("value", setValue)(event.target.value)}
              aria-invalid={errors.value ? true : undefined}
              aria-describedby={errors.value ? "target-value-error" : undefined}
            />
            {fieldError("value")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="target-note">{t("targets.form.note")}</Label>
            <Input
              id="target-note"
              value={note}
              maxLength={500}
              onChange={(event) => edit("note", setNote)(event.target.value)}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={errors.note ? "target-note-error" : undefined}
            />
            {fieldError("note")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="target-tags">{t("targets.form.tags")}</Label>
            <Input
              id="target-tags"
              value={tags}
              placeholder={t("targets.form.tagsHint")}
              onChange={(event) => edit("tags", setTags)(event.target.value)}
              aria-invalid={errors.tags ? true : undefined}
              aria-describedby={errors.tags ? "target-tags-error" : undefined}
            />
            {fieldError("tags")}
          </div>
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(mutation.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("targets.form.submitting") : t("targets.form.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
