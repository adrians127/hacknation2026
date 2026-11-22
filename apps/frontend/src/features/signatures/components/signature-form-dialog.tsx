import { Plus } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  SignatureCategorySchema,
  SignatureConfidenceSchema,
  SignatureSeveritySchema,
} from "@subsurf/contracts/signatures/detection.schema";
import {
  SIGNATURE_CONDITIONS_MAX,
  SignatureDefinitionSchema,
  SignatureMatchModeSchema,
  SignatureNameSchema,
  type Signature,
} from "@subsurf/contracts/signatures/signatures.schema";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateSignature } from "@/features/signatures/api/create-signature";
import { useUpdateSignature } from "@/features/signatures/api/update-signature";
import { ConditionEditor } from "@/features/signatures/components/condition-editor";
import { SignaturePreview } from "@/features/signatures/components/signature-preview";
import {
  EMPTY_FORM,
  emptyCondition,
  issueCondition,
  toBody,
  toDefinition,
  toFormState,
  type SignatureFormState,
} from "@/features/signatures/lib/signature-form";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useErrorMessage } from "@/hooks/use-error-message";

const NO_SEVERITY = "none";

function Field({ id, label, hint, error, children }: {
  id: string;
  label: string;
  hint?: string;
  error?: string | false;
  children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

function Choice<T extends string>({ id, value, options, label, onChange }: {
  id: string;
  value: T;
  options: readonly T[];
  label: (option: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <Select value={value} onValueChange={(raw) => onChange(options.find((option) => option === raw) ?? value)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={option}>
            {label(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Creates a signature (also as a copy of another one, built-ins included) or edits a custom one,
 * with what it would match in a scan before it is saved.
 */
export function SignatureFormDialog({
  signature,
  copy = false,
  onClose,
}: {
  signature: Signature | null;
  /** Start a new signature from `signature`. */
  copy?: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("signatures");
  const { t: tc } = useTranslation();
  const errorMessage = useErrorMessage();
  const create = useCreateSignature();
  const update = useUpdateSignature();
  const editing = signature !== null && !copy ? signature : null;
  const saving = create.isPending || update.isPending;
  const failed = create.isError ? create.error : update.isError ? update.error : null;

  const [form, setForm] = useState<SignatureFormState>(() =>
    signature ? toFormState(signature, copy) : EMPTY_FORM,
  );
  const [scanId, setScanId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const parsed = useMemo(() => SignatureDefinitionSchema.safeParse(toDefinition(form)), [form]);
  const invalidConditions = useMemo(
    () =>
      new Set(
        parsed.success ? [] : parsed.error.issues.map((issue) => issueCondition(issue.path)).filter((index) => index !== null),
      ),
    [parsed],
  );
  const previewBody = useMemo(
    () => (parsed.success ? { definition: parsed.data, confidence: form.confidence } : null),
    [parsed, form.confidence],
  );
  const debouncedPreview = useDebouncedValue(previewBody, 400);
  const isNameValid = SignatureNameSchema.safeParse(form.name).success;

  const set = (patch: Partial<SignatureFormState>) => setForm((previous) => ({ ...previous, ...patch }));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (!parsed.success || !isNameValid) return;
    const body = toBody(form, parsed.data);
    const onSuccess = () => {
      toast.success(t(editing ? "toast.updated" : "toast.created"));
      onClose();
    };
    if (editing) update.mutate({ params: { path: { id: editing.id } }, body }, { onSuccess });
    else create.mutate({ body }, { onSuccess });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <form onSubmit={submit} className="grid gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>
              {editing ? t("form.editTitle") : copy ? t("form.copyTitle", { name: signature?.name }) : t("form.createTitle")}
            </DialogTitle>
            <DialogDescription>{t("form.description")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id="signature-name"
              label={t("form.name")}
              error={submitted && !isNameValid && t("form.nameInvalid")}
            >
              <Input
                id="signature-name"
                value={form.name}
                maxLength={100}
                onChange={(event) => set({ name: event.target.value })}
                aria-invalid={submitted && !isNameValid ? true : undefined}
              />
            </Field>
            <Field id="signature-product" label={t("form.product")} hint={t("form.productHint")}>
              <Input
                id="signature-product"
                value={form.product}
                maxLength={100}
                onChange={(event) => set({ product: event.target.value })}
              />
            </Field>
            <Field id="signature-category" label={t("form.category")}>
              <Choice
                id="signature-category"
                value={form.category}
                options={SignatureCategorySchema.options}
                label={(category) => t(`categories.${category}`)}
                onChange={(category) => set({ category })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="signature-severity" label={t("form.severity")}>
                <Choice
                  id="signature-severity"
                  value={form.severity === "" ? NO_SEVERITY : form.severity}
                  options={[NO_SEVERITY, ...SignatureSeveritySchema.options]}
                  label={(severity) => t(`severities.${severity}`)}
                  onChange={(severity) => set({ severity: severity === NO_SEVERITY ? "" : severity })}
                />
              </Field>
              <Field id="signature-confidence" label={t("form.confidence")}>
                <Choice
                  id="signature-confidence"
                  value={form.confidence}
                  options={SignatureConfidenceSchema.options}
                  label={(confidence) => t(`confidence.${confidence}`)}
                  onChange={(confidence) => set({ confidence })}
                />
              </Field>
            </div>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">{t("form.ratingHint")}</p>

          <Field id="signature-description" label={t("form.notes")}>
            <Textarea
              id="signature-description"
              rows={2}
              maxLength={2000}
              value={form.description}
              onChange={(event) => set({ description: event.target.value })}
            />
          </Field>

          <section className="grid gap-3" aria-labelledby="signature-conditions-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h3 id="signature-conditions-title" className="text-sm font-medium">
                {t("form.conditions")}
              </h3>
              <div className="w-full max-w-xs">
                <Choice
                  id="signature-match"
                  value={form.match}
                  options={SignatureMatchModeSchema.options}
                  label={(match) => t(`match.${match}`)}
                  onChange={(match) => set({ match })}
                />
              </div>
            </div>
            {form.conditions.map((condition, index) => (
              <ConditionEditor
                key={condition.id}
                condition={condition}
                number={index + 1}
                invalid={submitted && invalidConditions.has(index)}
                canRemove={form.conditions.length > 1}
                onChange={(next) =>
                  set({ conditions: form.conditions.map((item) => (item.id === next.id ? next : item)) })
                }
                onRemove={() => set({ conditions: form.conditions.filter((item) => item.id !== condition.id) })}
              />
            ))}
            {submitted && !parsed.success && invalidConditions.size === 0 && (
              <p className="text-xs text-destructive">{t("form.needsCondition")}</p>
            )}
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={form.conditions.length >= SIGNATURE_CONDITIONS_MAX}
              onClick={() => set({ conditions: [...form.conditions, emptyCondition("header")] })}
            >
              <Plus />
              {t("form.addCondition")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("form.safety")}</p>
          </section>

          <section className="grid gap-2 rounded-lg border border-dashed p-3" aria-labelledby="signature-preview-title">
            <h3 id="signature-preview-title" className="text-sm font-medium">
              {t("preview.title")}
            </h3>
            <SignaturePreview body={debouncedPreview} scanId={scanId} onScanChange={setScanId} />
          </section>

          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(failed)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {editing ? t("form.save") : t("form.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
