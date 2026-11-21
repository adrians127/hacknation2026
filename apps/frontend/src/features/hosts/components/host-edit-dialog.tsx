import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  UpdateHostBodySchema,
  type HostListItem,
  type TriageStatus,
} from "@subsurf/contracts/hosts/hosts.schema";

import { Button } from "@/components/ui/button";
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
import { useUpdateHost } from "@/features/hosts/api/update-host";
import { TriageSelectField } from "@/features/hosts/components/triage-select-field";
import { useErrorMessage } from "@/hooks/use-error-message";
import { parseTags } from "@/lib/tags";

type Field = "note" | "tags";

interface HostEditDialogProps {
  host: Pick<HostListItem, "id" | "ip" | "note" | "tags" | "triage">;
  onClose: () => void;
}

export function HostEditDialog({ host, onClose }: HostEditDialogProps) {
  const { t } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const updateHost = useUpdateHost();

  const [note, setNote] = useState(host.note);
  const [tags, setTags] = useState(host.tags.join(", "));
  const [triage, setTriage] = useState<TriageStatus>(host.triage);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { note: note.trim(), tags: parseTags(tags), triage };
    const parsed = UpdateHostBodySchema.safeParse(body);
    if (!parsed.success) {
      const invalid = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        note: invalid.has("note") ? t("form.noteTooLong") : undefined,
        tags: invalid.has("tags") ? t("form.tagsInvalid") : undefined,
      });
      return;
    }
    setErrors({});
    updateHost.mutate(
      { params: { path: { id: host.id } }, body },
      {
        onSuccess: () => {
          toast.success(t("toast.hostSaved"));
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
            <DialogTitle>{t("form.hostTitle", { ip: host.ip })}</DialogTitle>
            <DialogDescription>{t("form.keptAcrossScans")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="host-note">{t("form.note")}</Label>
            <Textarea
              id="host-note"
              value={note}
              maxLength={2000}
              rows={4}
              onChange={(event) => {
                setNote(event.target.value);
                setErrors((prev) => ({ ...prev, note: undefined }));
              }}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={errors.note ? "host-note-error" : "host-note-hint"}
            />
            {errors.note ? (
              <p id="host-note-error" className="text-sm text-destructive">
                {errors.note}
              </p>
            ) : (
              <p id="host-note-hint" className="text-xs text-muted-foreground">
                {t("form.noteEncrypted")}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="host-tags">{t("form.tags")}</Label>
            <Input
              id="host-tags"
              value={tags}
              placeholder={t("form.tagsHint")}
              onChange={(event) => {
                setTags(event.target.value);
                setErrors((prev) => ({ ...prev, tags: undefined }));
              }}
              aria-invalid={errors.tags ? true : undefined}
              aria-describedby={errors.tags ? "host-tags-error" : undefined}
            />
            {errors.tags && (
              <p id="host-tags-error" className="text-sm text-destructive">
                {errors.tags}
              </p>
            )}
          </div>
          <TriageSelectField id="host-triage" value={triage} onChange={setTriage} />
          {updateHost.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(updateHost.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" disabled={updateHost.isPending}>
              {updateHost.isPending ? t("form.submitting") : t("form.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
