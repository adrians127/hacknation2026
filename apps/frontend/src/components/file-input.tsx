import { useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface LoadedFile {
  name: string;
  size: number;
  text: string;
}

interface FileInputProps {
  id: string;
  accept: string;
  maxBytes: number;
  file: LoadedFile | null;
  onLoad: (file: LoadedFile | null) => void;
}

/** Reads the chosen text file in the browser, so the page can show what it holds before sending it. */
export function FileInput({ id, accept, maxBytes, file, onLoad }: FileInputProps) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setError(null);
    if (!selected) {
      onLoad(null);
      return;
    }
    if (selected.size > maxBytes) {
      setError(t("file.tooLarge", { size: Math.floor(maxBytes / 1024 ** 2) }));
      onLoad(null);
      return;
    }
    try {
      onLoad({ name: selected.name, size: selected.size, text: await selected.text() });
    } catch {
      setError(t("file.unreadable"));
      onLoad(null);
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{t("file.label")}</Label>
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
          {t("file.selected", { name: file.name, size: Math.ceil(file.size / 1024) })}
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
