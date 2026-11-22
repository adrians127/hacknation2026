import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { SignatureExportDocumentSchema } from "@subsurf/contracts/signatures/signatures.schema";

import { FileInput, type LoadedFile } from "@/components/file-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useImportSignatures } from "@/features/signatures/api/import-signatures";
import { useErrorMessage } from "@/hooks/use-error-message";

const MAX_BYTES = 2 * 1024 ** 2;
const CONFLICTS = ["skip", "replace"] as const;
type Conflict = (typeof CONFLICTS)[number];

function readDocument(text: string) {
  try {
    return SignatureExportDocumentSchema.safeParse(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Reads a signatures file (`GET /signatures/export`) in the browser and imports it as a whole. */
export function ImportSignaturesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("signatures");
  const { t: tc } = useTranslation();
  const errorMessage = useErrorMessage();
  const importSignatures = useImportSignatures();
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [conflict, setConflict] = useState<Conflict>("skip");

  const parsed = useMemo(() => (file ? readDocument(file.text) : null), [file]);
  const document = parsed?.success ? parsed.data : null;
  const builtIns = document?.signatures.filter((item) => item.key).length ?? 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!document) return;
    importSignatures.mutate(
      { params: { query: { conflict } }, body: document },
      {
        onSuccess: (result) => {
          toast.success(t("toast.imported", result));
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
            <DialogTitle>{t("import.title")}</DialogTitle>
            <DialogDescription>{t("import.description")}</DialogDescription>
          </DialogHeader>
          <FileInput
            id="signatures-file"
            accept=".json,application/json"
            maxBytes={MAX_BYTES}
            file={file}
            onLoad={(next) => {
              setFile(next);
              importSignatures.reset();
            }}
          />
          {file && !document && (
            <p role="alert" className="text-sm text-destructive">
              {t("import.invalidFile")}
            </p>
          )}
          {document && (
            <p className="text-sm text-muted-foreground">
              {t("import.contents", { custom: document.signatures.length - builtIns, builtIn: builtIns })}
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="signatures-conflict">{t("import.conflict")}</Label>
            <Select
              value={conflict}
              onValueChange={(value) => setConflict(CONFLICTS.find((option) => option === value) ?? "skip")}
            >
              <SelectTrigger id="signatures-conflict" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONFLICTS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`import.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {importSignatures.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(importSignatures.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={importSignatures.isPending}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={!document || importSignatures.isPending}>
              {t("import.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
