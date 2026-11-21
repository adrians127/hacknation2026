import { ArrowLeft, Copy, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";

import { IconAction } from "@/components/icon-action";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRole } from "@/features/roles/api/get-role";
import { useRoles } from "@/features/roles/api/get-roles";
import { DeleteRoleDialog } from "@/features/roles/components/delete-role-dialog";
import { PermissionMatrix } from "@/features/roles/components/permission-matrix";
import { RoleFormDialog, type RoleFormMode } from "@/features/roles/components/role-form-dialog";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useRoleLabels } from "@/lib/auth/labels";
import { useMe } from "@/lib/auth/me-query";

export function RoleDetailRoute() {
  const { t } = useTranslation("admin");
  const { t: tCommon } = useTranslation();
  const { roleId = "" } = useParams();
  const navigate = useNavigate();
  const errorMessage = useErrorMessage();
  const roleLabels = useRoleLabels();
  const me = useMe();
  const role = useRole(roleId);
  const roles = useRoles();
  const [dialog, setDialog] = useState<RoleFormMode | "delete" | null>(null);

  const back = (
    <Button asChild variant="ghost" size="sm" className="w-fit">
      <Link to="/app/admin/roles">
        <ArrowLeft />
        {t("roles.detail.back")}
      </Link>
    </Button>
  );

  if (role.isPending) return <Skeleton className="h-64 w-full" />;
  if (role.isError) {
    return (
      <div className="grid gap-4">
        {back}
        <p role="alert" className="text-destructive">
          {errorMessage(role.error)}
        </p>
      </div>
    );
  }

  const detail = role.data;
  const name = roleLabels.name(detail);
  const lockedReason = detail.isSystem
    ? tCommon("errors.SYSTEM_ROLE_READ_ONLY")
    : detail.id === me.role.id
      ? tCommon("errors.SELF_MODIFICATION")
      : undefined;

  return (
    <div className="grid gap-6">
      {back}
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {name}
            <Badge variant={detail.isSystem ? "secondary" : "outline"}>
              {detail.isSystem ? t("roles.system") : t("roles.custom")}
            </Badge>
          </span>
        }
        description={
          <>
            {roleLabels.description(detail)}
            {detail.isSystem && <span className="block text-sm">{t("roles.detail.readOnly")}</span>}
          </>
        }
        actions={
          <div className="flex gap-1">
            <IconAction
              label={t("roles.actions.edit", { name })}
              icon={<Pencil />}
              permissions={["roles:update"]}
              disabledReason={lockedReason}
              onClick={() => setDialog("edit")}
            />
            <IconAction
              label={t("roles.actions.duplicate", { name })}
              icon={<Copy />}
              permissions={["roles:create"]}
              onClick={() => setDialog("duplicate")}
            />
            <IconAction
              label={t("roles.actions.delete", { name })}
              icon={<Trash2 />}
              permissions={["roles:delete"]}
              disabledReason={lockedReason}
              destructive
              onClick={() => setDialog("delete")}
            />
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("roles.detail.permissions")}</CardTitle>
        </CardHeader>
        <CardContent>
          <PermissionMatrix value={detail.permissions} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("roles.detail.members")}</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.users.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("roles.detail.noMembers")}</p>
          ) : (
            <ul className="divide-y">
              {detail.users.map((user) => (
                <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link to={`/app/admin/users?edit=${user.id}`} className="hover:underline">
                    <span className="font-medium">{user.displayName}</span>{" "}
                    <span className="text-sm text-muted-foreground">{user.email}</span>
                  </Link>
                  {!user.isActive && <Badge variant="outline">{t("roles.detail.inactive")}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {(dialog === "edit" || dialog === "duplicate") && (
        <RoleFormDialog mode={dialog} role={detail} onClose={() => setDialog(null)} />
      )}
      {dialog === "delete" && (
        <DeleteRoleDialog
          role={detail}
          roles={roles.data?.items ?? []}
          onClose={() => setDialog(null)}
          onDeleted={() => void navigate("/app/admin/roles", { replace: true })}
        />
      )}
    </div>
  );
}
