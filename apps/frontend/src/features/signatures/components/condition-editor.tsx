import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { SignatureTargetSchema } from "@subsurf/contracts/signatures/detection.schema";
import {
  SignatureMatchOpSchema,
  SignatureServiceFieldSchema,
} from "@subsurf/contracts/signatures/signatures.schema";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  VERSION_TARGETS,
  type ConditionForm,
  type MatcherForm,
} from "@/features/signatures/lib/signature-form";

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice<T extends string>({
  id,
  value,
  options,
  label,
  onChange,
  ariaLabel,
}: {
  id: string;
  value: T;
  options: readonly T[];
  label: (option: T) => string;
  onChange: (value: T) => void;
  ariaLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={(raw) => onChange(options.find((option) => option === raw) ?? value)}>
      <SelectTrigger id={id} className="w-full" aria-label={ariaLabel}>
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

/** How the text is compared, the text itself and whether case matters. */
function MatcherInput({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: MatcherForm;
  onChange: (value: MatcherForm) => void;
}) {
  const { t } = useTranslation("signatures");
  return (
    <Field id={id} label={label} hint={hint}>
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <Choice
          id={`${id}-op`}
          ariaLabel={t("form.op", { field: label })}
          value={value.op}
          options={SignatureMatchOpSchema.options}
          label={(op) => t(`ops.${op}`)}
          onChange={(op) => onChange({ ...value, op })}
        />
        <Input
          id={id}
          value={value.value}
          maxLength={500}
          className={value.op === "regex" ? "font-mono" : undefined}
          onChange={(event) => onChange({ ...value, value: event.target.value })}
        />
      </div>
      <Label className="flex w-fit items-center gap-2 text-xs font-normal">
        <Checkbox
          checked={value.caseSensitive}
          onCheckedChange={(checked) => onChange({ ...value, caseSensitive: checked === true })}
        />
        {t("form.caseSensitive")}
      </Label>
    </Field>
  );
}

/** One condition of a signature: what it reads and how it is compared. */
export function ConditionEditor({
  condition,
  number,
  invalid,
  canRemove,
  onChange,
  onRemove,
}: {
  condition: ConditionForm;
  number: number;
  invalid: boolean;
  canRemove: boolean;
  onChange: (condition: ConditionForm) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("signatures");
  const id = condition.id;
  const set = (patch: Partial<ConditionForm>) => onChange({ ...condition, ...patch });

  return (
    <fieldset
      className={
        invalid
          ? "grid gap-3 rounded-lg border border-destructive/60 p-3"
          : "grid gap-3 rounded-lg border p-3"
      }
    >
      <legend className="px-1 text-sm font-medium">{t("form.condition", { number })}</legend>
      <div className="flex items-end gap-2">
        <div className="grow">
          <Field id={`${id}-target`} label={t("form.target")}>
            <Choice
              id={`${id}-target`}
              value={condition.target}
              options={SignatureTargetSchema.options}
              label={(target) => t(`targets.${target}`)}
              onChange={(target) => set({ target })}
            />
          </Field>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={!canRemove}
          aria-label={t("form.removeCondition", { number })}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">{t(`targetHints.${condition.target}`)}</p>

      {condition.target === "header" && (
        <>
          <MatcherInput
            id={`${id}-name`}
            label={t("form.headerName")}
            value={condition.name}
            onChange={(name) => set({ name })}
          />
          <MatcherInput
            id={`${id}-value`}
            label={t("form.headerValue")}
            hint={t("form.headerValueHint")}
            value={condition.value}
            onChange={(value) => set({ value })}
          />
        </>
      )}
      {condition.target === "cookie" && (
        <MatcherInput
          id={`${id}-name`}
          label={t("form.cookieName")}
          value={condition.name}
          onChange={(name) => set({ name })}
        />
      )}
      {condition.target === "service" && (
        <Field id={`${id}-field`} label={t("form.field")}>
          <Choice
            id={`${id}-field`}
            value={condition.field}
            options={SignatureServiceFieldSchema.options}
            label={(field) => t(`fields.${field}`)}
            onChange={(field) => set({ field })}
          />
        </Field>
      )}
      {(condition.target === "title" ||
        condition.target === "body" ||
        condition.target === "banner" ||
        condition.target === "service") && (
        <MatcherInput
          id={`${id}-value`}
          label={t("form.value")}
          value={condition.value}
          onChange={(value) => set({ value })}
        />
      )}
      {condition.target === "favicon" && (
        <Field id={`${id}-mmh3`} label={t("form.mmh3")} hint={t("form.mmh3Hint")}>
          <Input
            id={`${id}-mmh3`}
            className="font-mono"
            value={condition.mmh3}
            onChange={(event) => set({ mmh3: event.target.value })}
          />
        </Field>
      )}
      {condition.target === "probe" && (
        <>
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <Field id={`${id}-path`} label={t("form.path")} hint={t("form.pathHint")}>
              <Input
                id={`${id}-path`}
                className="font-mono"
                maxLength={200}
                value={condition.path}
                onChange={(event) => set({ path: event.target.value })}
              />
            </Field>
            <Field id={`${id}-status`} label={t("form.status")} hint={t("form.listHint")}>
              <Input
                id={`${id}-status`}
                value={condition.status}
                onChange={(event) => set({ status: event.target.value })}
              />
            </Field>
          </div>
          <MatcherInput
            id={`${id}-title`}
            label={t("form.probeTitle")}
            hint={t("form.optionalHint")}
            value={condition.title}
            onChange={(title) => set({ title })}
          />
        </>
      )}
      {condition.target === "port" && (
        <Field id={`${id}-ports`} label={t("form.ports")} hint={t("form.portsHint")}>
          <Input
            id={`${id}-ports`}
            value={condition.ports}
            onChange={(event) => set({ ports: event.target.value })}
          />
        </Field>
      )}
      {VERSION_TARGETS.has(condition.target) && (
        <Field id={`${id}-version`} label={t("form.version")} hint={t("form.versionHint")}>
          <Input
            id={`${id}-version`}
            className="font-mono"
            maxLength={200}
            value={condition.version}
            onChange={(event) => set({ version: event.target.value })}
          />
        </Field>
      )}
      {invalid && <p className="text-xs text-destructive">{t("form.invalid")}</p>}
    </fieldset>
  );
}
