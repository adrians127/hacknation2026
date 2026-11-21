import { UserPlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { toast } from "sonner";

import type { User } from "@hacknation/contracts/users/users.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { GuardedButton } from "@/components/guarded-button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRoles } from "@/features/roles/api/get-roles";
import { useDeactivateUser } from "@/features/users/api/deactivate-user";
import { useUsers } from "@/features/users/api/get-users";
import { useReactivateUser } from "@/features/users/api/reactivate-user";
import { useResetUserPassword } from "@/features/users/api/reset-user-password";
import { TemporaryPasswordDialog } from "@/features/users/components/temporary-password-dialog";
import { UserFormDialog } from "@/features/users/components/user-form-dialog";
import { UsersTable } from "@/features/users/components/users-table";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; user: User }
  | { kind: "reset"; user: User }
  | { kind: "deactivate"; user: User }
  | { kind: "temporaryPassword"; email: string; password: string };

export function UsersRoute() {
  const { t } = useTranslation("admin");
  const errorMessage = useErrorMessage();
  const users = useUsers();
  // The role picker needs the role list, which is its own permission.
  const canReadRoles = useCan("roles:read");
  const roles = useRoles({ enabled: canReadRoles });
  const resetPassword = useResetUserPassword();
  const deactivate = useDeactivateUser();
  const reactivate = useReactivateUser();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // `?edit=<id>` (from a role's user list) opens that user's edit dialog.
  const [searchParams, setSearchParams] = useSearchParams();
  const canUpdate = useCan("users:update");
  const editFromLink = canUpdate
    ? users.data?.items.find((user) => user.id === searchParams.get("edit"))
    : undefined;
  const activeDialog: Dialog | null =
    dialog ?? (editFromLink ? { kind: "edit", user: editFromLink } : null);

  function closeDialog() {
    setDialog(null);
    if (searchParams.has("edit")) setSearchParams({}, { replace: true });
    resetPassword.reset();
    deactivate.reset();
  }

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("users.title")}</h1>
          <p className="text-muted-foreground">{t("users.description")}</p>
        </div>
        <GuardedButton
          permissions={["users:create", "roles:read"]}
          onClick={() => setDialog({ kind: "create" })}
        >
          <UserPlus />
          {t("users.create")}
        </GuardedButton>
      </header>

      {users.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : users.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(users.error)}
        </p>
      ) : (
        <UsersTable
          users={users.data.items}
          onEdit={(user) => setDialog({ kind: "edit", user })}
          onResetPassword={(user) => setDialog({ kind: "reset", user })}
          onDeactivate={(user) => setDialog({ kind: "deactivate", user })}
          onReactivate={(user) =>
            reactivate.mutate(
              { params: { path: { id: user.id } } },
              {
                onSuccess: () => toast.success(t("users.toast.reactivated")),
                onError: (error) => toast.error(errorMessage(error)),
              },
            )
          }
        />
      )}

      {(activeDialog?.kind === "create" || activeDialog?.kind === "edit") && (
        <UserFormDialog
          key={activeDialog.kind === "edit" ? activeDialog.user.id : "create"}
          user={activeDialog.kind === "edit" ? activeDialog.user : undefined}
          roles={roles.data?.items}
          onClose={closeDialog}
          onCreated={({ user, temporaryPassword }) =>
            setDialog({ kind: "temporaryPassword", email: user.email, password: temporaryPassword })
          }
        />
      )}

      {activeDialog?.kind === "reset" && (
        <ConfirmDialog
          title={t("users.confirmReset.title", { name: activeDialog.user.displayName })}
          description={t("users.confirmReset.description")}
          confirmLabel={t("users.confirmReset.confirm")}
          pending={resetPassword.isPending}
          error={resetPassword.isError ? errorMessage(resetPassword.error) : null}
          onCancel={closeDialog}
          onConfirm={() =>
            resetPassword.mutate(
              { params: { path: { id: activeDialog.user.id } } },
              {
                onSuccess: ({ user, temporaryPassword }) =>
                  setDialog({ kind: "temporaryPassword", email: user.email, password: temporaryPassword }),
              },
            )
          }
        />
      )}

      {activeDialog?.kind === "deactivate" && (
        <ConfirmDialog
          title={t("users.confirmDeactivate.title", { name: activeDialog.user.displayName })}
          description={t("users.confirmDeactivate.description")}
          confirmLabel={t("users.confirmDeactivate.confirm")}
          destructive
          pending={deactivate.isPending}
          error={deactivate.isError ? errorMessage(deactivate.error) : null}
          onCancel={closeDialog}
          onConfirm={() =>
            deactivate.mutate(
              { params: { path: { id: activeDialog.user.id } } },
              {
                onSuccess: () => {
                  toast.success(t("users.toast.deactivated"));
                  closeDialog();
                },
              },
            )
          }
        />
      )}

      {activeDialog?.kind === "temporaryPassword" && (
        <TemporaryPasswordDialog
          email={activeDialog.email}
          password={activeDialog.password}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
