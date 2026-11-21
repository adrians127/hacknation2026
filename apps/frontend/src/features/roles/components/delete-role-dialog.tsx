import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { Role } from "@subsurf/contracts/roles/roles.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDeleteRole } from "@/features/roles/api/delete-role";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useRoleLabels } from "@/lib/auth/labels";
import { usePermissions } from "@/lib/auth/use-can";

interface DeleteRoleDialogProps {
  role: Role;
  /** Candidates to move the role's users to. */
  roles: Role[];
  onClose: () => void;
  onDeleted?: () => void;
}

export function DeleteRoleDialog({ role, roles, onClose, onDeleted }: DeleteRoleDialogProps) {
  const { t } = useTranslation("admin");
  const errorMessage = useErrorMessage();
  const roleLabels = useRoleLabels();
  const held = usePermissions();
  const deleteRole = useDeleteRole();
  const [targetId, setTargetId] = useState<string>("");
  const inUse = role.userCount > 0;

  function confirm() {
    deleteRole.mutate(
      {
        params: {
          path: { id: role.id },
          query: inUse ? { reassignToRoleId: targetId } : {},
        },
      },
      {
        onSuccess: () => {
          toast.success(t("roles.toast.deleted"));
          onClose();
          onDeleted?.();
        },
      },
    );
  }

  return (
    <ConfirmDialog
      title={t("roles.delete.title", { name: roleLabels.name(role) })}
      description={t("roles.delete.description")}
      confirmLabel={t("roles.delete.confirm")}
      destructive
      pending={deleteRole.isPending}
      confirmDisabled={inUse && !targetId}
      error={deleteRole.isError ? errorMessage(deleteRole.error) : null}
      onConfirm={confirm}
      onCancel={onClose}
    >
      {inUse && (
        <div className="grid gap-2">
          <Label htmlFor="reassign-role">{t("roles.delete.inUse", { count: role.userCount })}</Label>
          <Select value={targetId} onValueChange={setTargetId}>
            <SelectTrigger id="reassign-role" className="w-full">
              <SelectValue placeholder={t("roles.delete.targetPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {roles
                .filter((candidate) => candidate.id !== role.id)
                .map((candidate) => (
                  <SelectItem
                    key={candidate.id}
                    value={candidate.id}
                    // Moving users into a role you could not grant would be an escalation.
                    disabled={!candidate.permissions.every((permission) => held.has(permission))}
                  >
                    {roleLabels.name(candidate)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </ConfirmDialog>
  );
}
