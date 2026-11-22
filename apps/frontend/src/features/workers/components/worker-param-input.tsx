import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { WorkerParamField, WorkerParamValue } from "@subsurf/contracts/workers/worker-catalog";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useParamLabel } from "@/features/workers/lib/param-label";

interface WorkerParamInputProps {
  id: string;
  field: WorkerParamField;
  value: WorkerParamValue | undefined;
  onChange: (value: WorkerParamValue | undefined) => void;
  error?: string;
  disabled?: boolean;
}

/** One worker-specific job field as a form control; `undefined` means "use the default". */
export function WorkerParamInput({ id, field, value, onChange, error, disabled }: WorkerParamInputProps) {
  const label = useParamLabel()(field);
  const describedBy = error ? `${id}-error` : field.description ? `${id}-hint` : undefined;
  const hint = (
    <>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        field.description && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {field.description}
          </p>
        )
      )}
    </>
  );

  if (field.type === "boolean") {
    return (
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={value === true}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(checked === true)}
          aria-describedby={describedBy}
        />
        <div className="grid gap-1">
          <Label htmlFor={id}>{label}</Label>
          {hint}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {field.type === "integer" && (
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          value={typeof value === "number" ? value : ""}
          placeholder={field.default === undefined ? undefined : String(field.default)}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) =>
            onChange(event.target.value === "" ? undefined : Number(event.target.value))
          }
        />
      )}
      {field.type === "enum" && (
        <Select
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onValueChange={(next) => onChange(next)}
        >
          <SelectTrigger id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
            <SelectValue placeholder={field.default} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {field.type === "paths" && (
        <PathsInput
          id={id}
          value={Array.isArray(value) ? value : []}
          onChange={onChange}
          disabled={disabled}
          invalid={Boolean(error)}
          describedBy={describedBy}
        />
      )}
      {field.key === "probe_paths" && <SignatureProbesHint />}
      {hint}
    </div>
  );
}

/** Keeps its own text, so blank lines survive while typing; the value is the non-blank lines. */
function PathsInput({
  id,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: {
  id: string;
  value: readonly string[];
  onChange: (paths: string[]) => void;
  disabled?: boolean;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  const [text, setText] = useState(() => value.join("\n"));
  return (
    <Textarea
      id={id}
      rows={3}
      className="font-mono text-xs"
      value={text}
      placeholder="/admin"
      disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(event) => {
        setText(event.target.value);
        onChange(
          event.target.value
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

/** Scans also request what the enabled detection signatures need, without listing it here. */
function SignatureProbesHint() {
  const { t } = useTranslation("signatures");
  return <p className="text-xs text-muted-foreground">{t("probePathsHint")}</p>;
}
