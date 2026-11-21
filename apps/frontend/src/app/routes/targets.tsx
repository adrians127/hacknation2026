import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import type { Target } from "@subsurf/contracts/targets/targets.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { GuardedButton } from "@/components/guarded-button";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteTarget } from "@/features/targets/api/delete-target";
import { useTargets } from "@/features/targets/api/get-targets";
import { TargetDialog } from "@/features/targets/components/target-dialog";
import { TargetsTable } from "@/features/targets/components/targets-table";
import { useErrorMessage } from "@/hooks/use-error-message";

type Dialog = { kind: "edit"; target: Target } | { kind: "delete"; target: Target };

export function TargetsRoute() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const targets = useTargets();
  const deleteTarget = useDeleteTarget();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  function closeDialog() {
    setDialog(null);
    deleteTarget.reset();
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        mocked
        title={t("targets.title")}
        description={t("targets.subtitle")}
        actions={
          <GuardedButton permissions={["targets:create"]} onClick={() => void navigate("/app/targets/new")}>
            <Plus />
            {t("targets.add")}
          </GuardedButton>
        }
      />

      {targets.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : targets.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(targets.error)}
        </p>
      ) : (
        <Card>
          <CardContent>
            <TargetsTable
              targets={targets.data.items}
              onEdit={(target) => setDialog({ kind: "edit", target })}
              onDelete={(target) => setDialog({ kind: "delete", target })}
            />
          </CardContent>
        </Card>
      )}

      {dialog?.kind === "edit" && (
        <TargetDialog key={dialog.target.id} target={dialog.target} onClose={closeDialog} />
      )}

      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={t("targets.confirmDelete.title", { value: dialog.target.value })}
          description={t("targets.confirmDelete.description")}
          confirmLabel={t("targets.confirmDelete.confirm")}
          destructive
          pending={deleteTarget.isPending}
          error={deleteTarget.isError ? errorMessage(deleteTarget.error) : null}
          onCancel={closeDialog}
          onConfirm={() =>
            deleteTarget.mutate(
              { params: { path: { id: dialog.target.id } } },
              {
                onSuccess: () => {
                  toast.success(t("targets.toast.deleted"));
                  closeDialog();
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
