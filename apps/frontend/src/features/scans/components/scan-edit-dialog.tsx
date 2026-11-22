import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  SCAN_NAME_MAX,
  SCAN_NOTE_MAX,
  UpdateScanBodySchema,
} from "@subsurf/contracts/scans/scans.schema";

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
import { useUpdateScan } from "@/features/scans/api/update-scan";
import { useErrorMessage } from "@/hooks/use-error-message";

interface ScanEditDialogProps {
  scan: { id: string; name: string; note: string };
  onClose: () => void;
}

/** A scan's name and note. What it found and the parameters it ran with are not editable. */
export function ScanEditDialog({ scan, onClose }: ScanEditDialogProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const updateScan = useUpdateScan();
  const [name, setName] = useState(scan.name);
  const [note, setNote] = useState(scan.note);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = { name: name.trim(), note: note.trim() };
    if (!UpdateScanBodySchema.safeParse(body).success) return;
    updateScan.mutate(
      { params: { path: { id: scan.id } }, body },
      {
        onSuccess: () => {
          toast.success(t("scans.edit.saved"));
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
            <DialogTitle>{t("scans.edit.title")}</DialogTitle>
            <DialogDescription>{t("scans.edit.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="scan-name">{t("scans.edit.name")}</Label>
            <Input
              id="scan-name"
              value={name}
              maxLength={SCAN_NAME_MAX}
              onChange={(event) => setName(event.target.value)}
              aria-describedby="scan-name-hint"
            />
            <p id="scan-name-hint" className="text-xs text-muted-foreground">
              {t("scans.edit.nameHint")}
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="scan-note">{t("scans.edit.note")}</Label>
            <Textarea
              id="scan-note"
              value={note}
              maxLength={SCAN_NOTE_MAX}
              rows={4}
              onChange={(event) => setNote(event.target.value)}
              aria-describedby="scan-note-hint"
            />
            <p id="scan-note-hint" className="text-xs text-muted-foreground">
              {t("scans.edit.noteHint")}
            </p>
          </div>
          {updateScan.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(updateScan.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("actions.cancel")}
            </Button>
            <Button type="submit" disabled={updateScan.isPending}>
              {t(updateScan.isPending ? "scans.edit.submitting" : "scans.edit.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
