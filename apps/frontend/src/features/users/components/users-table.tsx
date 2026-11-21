import { KeyRound, Pencil, UserCheck, UserX } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import type { User } from "@hacknation/contracts/users/users.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { useRoleLabels } from "@/lib/auth/labels";
import { useMe } from "@/lib/auth/me-query";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDateTime } from "@/lib/format";

interface UsersTableProps {
  users: User[];
  onEdit: (user: User) => void;
  onResetPassword: (user: User) => void;
  onDeactivate: (user: User) => void;
  onReactivate: (user: User) => void;
}

const column = createDataTableColumns<User>();

export function UsersTable({
  users,
  onEdit,
  onResetPassword,
  onDeactivate,
  onReactivate,
}: UsersTableProps) {
  const { t, i18n } = useTranslation("admin");
  const { t: tCommon } = useTranslation();
  const roleLabels = useRoleLabels();
  const myId = useMe().id;
  const locale = i18n.resolvedLanguage;

  const columns = useMemo(
    () =>
      column.columns([
        column.accessor("displayName", {
          header: t("users.columns.user"),
          cell: ({ row }) => (
            <>
              <div className="font-medium">
                {row.original.displayName}
                {row.original.id === myId && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({t("users.you")})
                  </span>
                )}
              </div>
              <div className="text-sm text-muted-foreground">{row.original.email}</div>
            </>
          ),
        }),
        column.accessor((user) => roleLabels.name(user.role), {
          id: "role",
          header: t("users.columns.role"),
        }),
        column.display({
          id: "status",
          header: t("users.columns.status"),
          cell: ({ row: { original: user } }) => (
            <div className="flex flex-wrap gap-1">
              <Badge variant={user.isActive ? "secondary" : "outline"}>
                {user.isActive ? t("users.status.active") : t("users.status.inactive")}
              </Badge>
              {user.lockedUntil && <Badge variant="destructive">{t("users.status.locked")}</Badge>}
              {user.mustChangePassword && (
                <Badge variant="outline">{t("users.status.mustChangePassword")}</Badge>
              )}
            </div>
          ),
        }),
        column.accessor("lastLoginAt", {
          header: t("users.columns.lastLogin"),
          sortFn: "datetime",
          meta: { className: "text-muted-foreground" },
          cell: ({ getValue }) => {
            const value = getValue();
            return value ? formatDateTime(value, locale) : t("users.neverSignedIn");
          },
        }),
        column.display({
          id: "actions",
          header: () => <span className="sr-only">{t("users.columns.actions")}</span>,
          cell: ({ row: { original: user } }) => {
            const name = user.displayName;
            const selfReason = user.id === myId ? tCommon("errors.SELF_MODIFICATION") : undefined;
            return (
              <div className="flex justify-end gap-1">
                <IconAction
                  label={t("users.actions.edit", { name })}
                  icon={<Pencil />}
                  permissions={["users:update"]}
                  onClick={() => onEdit(user)}
                />
                <IconAction
                  label={t("users.actions.resetPassword", { name })}
                  icon={<KeyRound />}
                  permissions={["users:update"]}
                  disabledReason={selfReason}
                  onClick={() => onResetPassword(user)}
                />
                {user.isActive ? (
                  <IconAction
                    label={t("users.actions.deactivate", { name })}
                    icon={<UserX />}
                    permissions={["users:delete"]}
                    disabledReason={selfReason}
                    destructive
                    onClick={() => onDeactivate(user)}
                  />
                ) : (
                  <IconAction
                    label={t("users.actions.reactivate", { name })}
                    icon={<UserCheck />}
                    permissions={["users:delete"]}
                    onClick={() => onReactivate(user)}
                  />
                )}
              </div>
            );
          },
        }),
      ]),
    [t, tCommon, roleLabels, myId, locale, onEdit, onResetPassword, onDeactivate, onReactivate],
  );

  return (
    <DataTable
      columns={columns}
      data={users}
      emptyLabel={t("users.empty")}
      rowClassName={(user) => (user.isActive ? undefined : "opacity-60")}
    />
  );
}
