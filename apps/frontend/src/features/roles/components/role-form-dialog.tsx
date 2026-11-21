import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { Permission } from "@subsurf/contracts/auth/permissions";
import type { Role } from "@subsurf/contracts/roles/roles.schema";

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
import { useCreateRole } from "@/features/roles/api/create-role";
import { useUpdateRole } from "@/features/roles/api/update-role";
import { PermissionMatrix } from "@/features/roles/components/permission-matrix";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useRoleLabels } from "@/lib/auth/labels";
import { usePermissions } from "@/lib/auth/use-can";

export type RoleFormMode = "create" | "edit" | "duplicate";

interface RoleFormDialogProps {
  mode: RoleFormMode;
  /** The role to edit, or the one being duplicated. */
  role?: Role;
  onClose: () => void;
}

export function RoleFormDialog({ mode, role, onClose }: RoleFormDialogProps) {
  const { t } = useTranslation("admin");
  const errorMessage = useErrorMessage();
  const roleLabels = useRoleLabels();
  const grantable = usePermissions();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const mutation = mode === "edit" ? updateRole : createRole;

  const [name, setName] = useState(() => {
    if (!role) return "";
    return mode === "duplicate" ? t("roles.copyOf", { name: roleLabels.name(role) }) : role.name;
  });
  const [description, setDescription] = useState(() =>
    role ? roleLabels.description(role) : "",
  );
  const [permissions, setPermissions] = useState<Permission[]>(() => [...(role?.permissions ?? [])]);
  const [nameError, setNameError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/\S/.test(name)) {
      setNameError(t("roles.form.nameRequired"));
      return;
    }
    setNameError(null);
    const body = { name: name.trim(), description: description.trim(), permissions };
    const onSuccess = () => {
      toast.success(t(mode === "edit" ? "roles.toast.updated" : "roles.toast.created"));
      onClose();
    };
    if (mode === "edit" && role) {
      updateRole.mutate({ params: { path: { id: role.id } }, body }, { onSuccess });
    } else {
      createRole.mutate({ body }, { onSuccess });
    }
  }

  const title = {
    create: t("roles.form.createTitle"),
    edit: t("roles.form.editTitle"),
    duplicate: t("roles.form.duplicateTitle"),
  }[mode];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{t("roles.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="role-name">{t("roles.form.name")}</Label>
            <Input
              id="role-name"
              value={name}
              maxLength={64}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "role-name-error" : undefined}
            />
            {nameError && (
              <p id="role-name-error" className="text-sm text-destructive">
                {nameError}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="role-description">{t("roles.form.description")}</Label>
            <Input
              id="role-description"
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">{t("roles.form.permissions")}</legend>
            <PermissionMatrix value={permissions} onChange={setPermissions} grantable={grantable} />
          </fieldset>
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(mutation.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? t("roles.form.submitting")
                : t(mode === "edit" ? "roles.form.submitEdit" : "roles.form.submitCreate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
