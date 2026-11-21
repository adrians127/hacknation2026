import { useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import { TARGET_IMPORT_LIMITS } from "@hacknation/contracts/targets/target-input";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface LoadedFile {
  name: string;
  size: number;
  text: string;
}

interface TargetFileInputProps {
  id: string;
  accept: string;
  file: LoadedFile | null;
  onLoad: (file: LoadedFile | null) => void;
}

/** Reads the chosen file in the browser; only the parsed entries are sent to the API. */
export function TargetFileInput({ id, accept, file, onLoad }: TargetFileInputProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setError(null);
    if (!selected) {
      onLoad(null);
      return;
    }
    if (selected.size > TARGET_IMPORT_LIMITS.maxFileBytes) {
      setError(t("targets.import.file.tooLarge"));
      onLoad(null);
      return;
    }
    try {
      onLoad({ name: selected.name, size: selected.size, text: await selected.text() });
    } catch {
      setError(t("targets.import.file.unreadable"));
      onLoad(null);
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t("targets.import.file.label")}</Label>
      <Input
        id={id}
        type="file"
        accept={accept}
        onChange={(event) => void load(event)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {file && (
        <p className="text-sm text-muted-foreground">
          {t("targets.import.file.selected", { name: file.name, size: Math.ceil(file.size / 1024) })}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
