import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Role } from "@hacknation/contracts/roles/roles.schema";

import { GuardedButton } from "@/components/guarded-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoles } from "@/features/roles/api/get-roles";
import { DeleteRoleDialog } from "@/features/roles/components/delete-role-dialog";
import { RoleFormDialog, type RoleFormMode } from "@/features/roles/components/role-form-dialog";
import { RolesTable } from "@/features/roles/components/roles-table";
import { useErrorMessage } from "@/hooks/use-error-message";

type Dialog = { kind: RoleFormMode; role?: Role } | { kind: "delete"; role: Role };

export function RolesRoute() {
  const { t } = useTranslation("admin");
  const errorMessage = useErrorMessage();
  const roles = useRoles();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("roles.title")}</h1>
          <p className="max-w-2xl text-muted-foreground">{t("roles.description")}</p>
        </div>
        <GuardedButton permissions={["roles:create"]} onClick={() => setDialog({ kind: "create" })}>
          <Plus />
          {t("roles.create")}
        </GuardedButton>
      </header>

      {roles.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : roles.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(roles.error)}
        </p>
      ) : (
        <RolesTable
          roles={roles.data.items}
          onEdit={(role) => setDialog({ kind: "edit", role })}
          onDuplicate={(role) => setDialog({ kind: "duplicate", role })}
          onDelete={(role) => setDialog({ kind: "delete", role })}
        />
      )}

      {dialog && dialog.kind !== "delete" && (
        <RoleFormDialog
          key={`${dialog.kind}-${dialog.role?.id ?? "new"}`}
          mode={dialog.kind}
          role={dialog.role}
          onClose={close}
        />
      )}
      {dialog?.kind === "delete" && (
        <DeleteRoleDialog role={dialog.role} roles={roles.data?.items ?? []} onClose={close} />
      )}
    </div>
  );
}
