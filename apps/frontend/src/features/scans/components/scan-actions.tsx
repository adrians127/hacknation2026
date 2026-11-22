import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { GuardedButton } from "@/components/guarded-button";
import { useDeleteScan } from "@/features/scans/api/delete-scan";
import { ScanEditDialog } from "@/features/scans/components/scan-edit-dialog";
import { useErrorMessage } from "@/hooks/use-error-message";

interface ScanActionsProps {
  scan: { id: string; name: string; note: string };
  /** For the confirmation: which scan is about to go. */
  label: string;
}

/** Rename/annotate and delete, each behind its permission. */
export function ScanActions({ scan, label }: ScanActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const deleteScan = useDeleteScan();
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);

  function close() {
    setDialog(null);
    deleteScan.reset();
  }

  return (
    <>
      <GuardedButton variant="outline" permissions={["scans:update"]} onClick={() => setDialog("edit")}>
        <Pencil />
        {t("scans.edit.open")}
      </GuardedButton>
      <GuardedButton variant="outline" permissions={["scans:delete"]} onClick={() => setDialog("delete")}>
        <Trash2 />
        {t("scans.remove.open")}
      </GuardedButton>

      {dialog === "edit" && <ScanEditDialog scan={scan} onClose={close} />}
      {dialog === "delete" && (
        <ConfirmDialog
          title={t("scans.remove.title", { scan: label })}
          description={t("scans.remove.description")}
          confirmLabel={t("scans.remove.confirm")}
          destructive
          pending={deleteScan.isPending}
          error={deleteScan.isError ? errorMessage(deleteScan.error) : null}
          onCancel={close}
          onConfirm={() =>
            deleteScan.mutate(
              { params: { path: { id: scan.id } } },
              {
                onSuccess: () => {
                  toast.success(t("scans.remove.deleted"));
                  void navigate("/app/scans");
                },
              },
            )
          }
        />
      )}
    </>
  );
}
