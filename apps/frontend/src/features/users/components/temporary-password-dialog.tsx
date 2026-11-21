import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface TemporaryPasswordDialogProps {
  email: string;
  password: string;
  onClose: () => void;
}

/** The server returns a temporary password exactly once; this is the only place it is shown. */
export function TemporaryPasswordDialog({ email, password, onClose }: TemporaryPasswordDialogProps) {
  const { t } = useTranslation("admin");
  const { t: tCommon } = useTranslation();
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(password).then(() => setCopied(true));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("users.temporaryPassword.title")}</DialogTitle>
          <DialogDescription>{t("users.temporaryPassword.description", { email })}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
          <code className="flex-1 font-mono text-base break-all select-all">{password}</code>
          <Button type="button" variant="outline" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? tCommon("actions.copied") : tCommon("actions.copy")}
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{t("users.temporaryPassword.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
