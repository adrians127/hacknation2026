import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  UpdateServiceBodySchema,
  type ServiceIdentity,
  type ServiceSummary,
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
import { useUpdateService } from "@/features/hosts/api/update-service";
import { TriageSelectField } from "@/features/hosts/components/triage-select-field";
import { useErrorMessage } from "@/hooks/use-error-message";
import { parseTags } from "@/lib/tags";

type Field = "note" | "tags" | "overrides";
type IdentityField = keyof ServiceIdentity;

const IDENTITY_FIELDS: readonly IdentityField[] = ["name", "product", "version"];

/** An emptied correction field removes the correction (`null`), so the scan's value shows again. */
const toOverride = (value: string) => value.trim() || null;

interface ServiceEditDialogProps {
  hostId: string;
  hostIp: string;
  service: Pick<ServiceSummary, "id" | "port" | "protocol" | "observed" | "overrides" | "note" | "tags" | "triage">;
  onClose: () => void;
}

export function ServiceEditDialog({ hostId, hostIp, service, onClose }: ServiceEditDialogProps) {
  const { t } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const updateService = useUpdateService();

  const [note, setNote] = useState(service.note);
  const [tags, setTags] = useState(service.tags.join(", "));
  const [triage, setTriage] = useState<TriageStatus>(service.triage);
  const [overrides, setOverrides] = useState<Record<IdentityField, string>>({
    name: service.overrides.name ?? "",
    product: service.overrides.product ?? "",
    version: service.overrides.version ?? "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = {
      note: note.trim(),
      tags: parseTags(tags),
      triage,
      nameOverride: toOverride(overrides.name),
      productOverride: toOverride(overrides.product),
      versionOverride: toOverride(overrides.version),
    };
    const parsed = UpdateServiceBodySchema.safeParse(body);
    if (!parsed.success) {
      const invalid = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
      setErrors({
        note: invalid.has("note") ? t("form.noteTooLong") : undefined,
        tags: invalid.has("tags") ? t("form.tagsInvalid") : undefined,
        overrides: [...invalid].some((key) => key.endsWith("Override"))
          ? t("form.overrideInvalid")
          : undefined,
      });
      return;
    }
    setErrors({});
    updateService.mutate(
      { params: { path: { id: hostId, serviceId: service.id } }, body },
      {
        onSuccess: () => {
          toast.success(t("toast.serviceSaved"));
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
            <DialogTitle>
              {t("form.serviceTitle", { port: service.port, protocol: service.protocol, ip: hostIp })}
            </DialogTitle>
            <DialogDescription>{t("form.keptAcrossScans")}</DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-3 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("form.corrections")}</legend>
            <p className="text-xs text-muted-foreground">{t("form.correctionsHint")}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {IDENTITY_FIELDS.map((field) => (
                <div key={field} className="grid gap-1.5">
                  <Label htmlFor={`service-${field}`}>{t(`form.identity.${field}`)}</Label>
                  <Input
                    id={`service-${field}`}
                    value={overrides[field]}
                    maxLength={200}
                    placeholder={service.observed[field] ?? "—"}
                    onChange={(event) => {
                      const value = event.target.value;
                      setOverrides((prev) => ({ ...prev, [field]: value }));
                      setErrors((prev) => ({ ...prev, overrides: undefined }));
                    }}
                    aria-invalid={errors.overrides ? true : undefined}
                  />
                </div>
              ))}
            </div>
            {errors.overrides && <p className="text-sm text-destructive">{errors.overrides}</p>}
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor="service-note">{t("form.note")}</Label>
            <Textarea
              id="service-note"
              value={note}
              maxLength={2000}
              rows={3}
              onChange={(event) => {
                setNote(event.target.value);
                setErrors((prev) => ({ ...prev, note: undefined }));
              }}
              aria-invalid={errors.note ? true : undefined}
              aria-describedby={errors.note ? "service-note-error" : "service-note-hint"}
            />
            {errors.note ? (
              <p id="service-note-error" className="text-sm text-destructive">
                {errors.note}
              </p>
            ) : (
              <p id="service-note-hint" className="text-xs text-muted-foreground">
                {t("form.noteEncrypted")}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="service-tags">{t("form.tags")}</Label>
            <Input
              id="service-tags"
              value={tags}
              placeholder={t("form.tagsHint")}
              onChange={(event) => {
                setTags(event.target.value);
                setErrors((prev) => ({ ...prev, tags: undefined }));
              }}
              aria-invalid={errors.tags ? true : undefined}
              aria-describedby={errors.tags ? "service-tags-error" : undefined}
            />
            {errors.tags && (
              <p id="service-tags-error" className="text-sm text-destructive">
                {errors.tags}
              </p>
            )}
          </div>
          <TriageSelectField id="service-triage" value={triage} onChange={setTriage} />
          {updateService.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(updateService.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" disabled={updateService.isPending}>
              {updateService.isPending ? t("form.submitting") : t("form.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
