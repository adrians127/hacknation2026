import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { Role } from "@subsurf/contracts/roles/roles.schema";
import {
  CreateUserBodySchema,
  type User,
  type UserWithTemporaryPasswordResponse,
} from "@subsurf/contracts/users/users.schema";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateUser } from "@/features/users/api/create-user";
import { useUpdateUser } from "@/features/users/api/update-user";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useRoleLabels } from "@/lib/auth/labels";
import { useMe } from "@/lib/auth/me-query";
import { usePermissions } from "@/lib/auth/use-can";

type Field = "email" | "displayName" | "roleId";

interface UserFormDialogProps {
  /** Edits this user; creates a new one when absent. */
  user?: User;
  /** Undefined when the caller cannot list roles (no `roles:read`). */
  roles: Role[] | undefined;
  onClose: () => void;
  onCreated: (result: UserWithTemporaryPasswordResponse) => void;
}

export function UserFormDialog({ user, roles, onClose, onCreated }: UserFormDialogProps) {
  const { t } = useTranslation("admin");
  const errorMessage = useErrorMessage();
  const roleLabels = useRoleLabels();
  const held = usePermissions();
  const me = useMe();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const mutation = user ? updateUser : createUser;

  const [email, setEmail] = useState(user?.email ?? "");
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [roleId, setRoleId] = useState(user?.role.id ?? "");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const ownAccount = user?.id === me.id;
  // A field's error disappears as soon as it is edited.
  const edit = (field: Field, set: (value: string) => void) => (value: string) => {
    set(value);
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = CreateUserBodySchema.safeParse({
      email: user ? user.email : email.trim(),
      displayName,
      roleId,
    });
    if (!parsed.success) {
      const invalid = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setErrors({
        email: invalid.has("email") ? t("users.form.invalidEmail") : undefined,
        displayName: invalid.has("displayName") ? t("users.form.displayNameRequired") : undefined,
        roleId: invalid.has("roleId") ? t("users.form.roleRequired") : undefined,
      });
      return;
    }
    setErrors({});

    if (user) {
      updateUser.mutate(
        {
          params: { path: { id: user.id } },
          body: {
            displayName: displayName.trim(),
            ...(roleId !== user.role.id ? { roleId } : {}),
          },
        },
        {
          onSuccess: () => {
            toast.success(t("users.toast.updated"));
            onClose();
          },
        },
      );
    } else {
      createUser.mutate(
        { body: { ...parsed.data, displayName: displayName.trim() } },
        {
          onSuccess: (result) => {
            toast.success(t("users.toast.created"));
            onCreated(result);
          },
        },
      );
    }
  }

  // Without roles:read the list is unknown; editing still shows the current role.
  const roleOptions = roles ?? (user ? [{ ...user.role, permissions: [] as Role["permissions"] }] : []);

  const fieldError = (name: Field) =>
    errors[name] && (
      <p id={`user-${name}-error`} className="text-sm text-destructive">
        {errors[name]}
      </p>
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{user ? t("users.form.editTitle") : t("users.form.createTitle")}</DialogTitle>
            {!user && <DialogDescription>{t("users.form.createDescription")}</DialogDescription>}
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="user-email">{t("users.form.email")}</Label>
            <Input
              id="user-email"
              type="email"
              value={email}
              disabled={Boolean(user)}
              onChange={(event) => edit("email", setEmail)(event.target.value)}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "user-email-error" : undefined}
            />
            {fieldError("email")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-displayName">{t("users.form.displayName")}</Label>
            <Input
              id="user-displayName"
              value={displayName}
              maxLength={100}
              onChange={(event) => edit("displayName", setDisplayName)(event.target.value)}
              aria-invalid={errors.displayName ? true : undefined}
              aria-describedby={errors.displayName ? "user-displayName-error" : undefined}
            />
            {fieldError("displayName")}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="user-roleId">{t("users.form.role")}</Label>
            <Select value={roleId} onValueChange={edit("roleId", setRoleId)} disabled={ownAccount || !roles}>
              <SelectTrigger
                id="user-roleId"
                className="w-full"
                aria-invalid={errors.roleId ? true : undefined}
                aria-describedby={errors.roleId ? "user-roleId-error" : "user-roleId-note"}
              >
                <SelectValue placeholder={t("users.form.rolePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => {
                  const grantable = role.permissions.every((permission) => held.has(permission));
                  return (
                    <SelectItem key={role.id} value={role.id} disabled={!grantable}>
                      {roleLabels.name(role)}
                      {!grantable && (
                        <span className="text-xs text-muted-foreground">
                          ({t("users.form.roleNotGrantable")})
                        </span>
                      )}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {fieldError("roleId") ?? (
              <p id="user-roleId-note" className="text-sm text-muted-foreground">
                {ownAccount ? t("users.form.ownRoleLocked") : !roles ? t("users.form.rolesUnavailable") : null}
              </p>
            )}
          </div>
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(mutation.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? t("users.form.submitting")
                : user
                  ? t("users.form.submitEdit")
                  : t("users.form.submitCreate")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
