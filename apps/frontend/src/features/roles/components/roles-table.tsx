import { Copy, Eye, Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Role } from "@subsurf/contracts/roles/roles.schema";

import { DataTable } from "@/components/data-table";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { useRoleLabels } from "@/lib/auth/labels";
import { useMe } from "@/lib/auth/me-query";
import { createDataTableColumns } from "@/lib/data-table";

interface RolesTableProps {
  roles: Role[];
  onEdit: (role: Role) => void;
  onDuplicate: (role: Role) => void;
  onDelete: (role: Role) => void;
}

const column = createDataTableColumns<Role>();

export function RolesTable({ roles, onEdit, onDuplicate, onDelete }: RolesTableProps) {
  const { t } = useTranslation("admin");
  const { t: tCommon } = useTranslation();
  const roleLabels = useRoleLabels();
  const myRoleId = useMe().role.id;

  const columns = useMemo(() => {
    const lockedReason = (role: Role) => {
      if (role.isSystem) return tCommon("errors.SYSTEM_ROLE_READ_ONLY");
      if (role.id === myRoleId) return tCommon("errors.SELF_MODIFICATION");
      return undefined;
    };

    return column.columns([
      column.accessor((role) => roleLabels.name(role), {
        id: "name",
        header: t("roles.columns.name"),
        cell: ({ row: { original: role }, getValue }) => (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/app/admin/roles/${role.id}`} className="font-medium hover:underline">
                {getValue()}
              </Link>
              <Badge variant={role.isSystem ? "secondary" : "outline"}>
                {role.isSystem ? t("roles.system") : t("roles.custom")}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{roleLabels.description(role)}</p>
          </>
        ),
      }),
      column.accessor("userCount", {
        header: t("roles.columns.users"),
        meta: { className: "text-right tabular-nums" },
      }),
      column.accessor((role) => role.permissions.length, {
        id: "permissions",
        header: t("roles.columns.permissions"),
        meta: { className: "text-right text-muted-foreground" },
        cell: ({ getValue }) => t("roles.permissionCount", { count: getValue() }),
      }),
      column.display({
        id: "actions",
        header: () => <span className="sr-only">{t("roles.columns.actions")}</span>,
        cell: ({ row: { original: role } }) => {
          const name = roleLabels.name(role);
          return (
            <div className="flex justify-end gap-1">
              <IconAction
                label={t("roles.actions.view", { name })}
                icon={<Eye />}
                to={`/app/admin/roles/${role.id}`}
              />
              <IconAction
                label={t("roles.actions.edit", { name })}
                icon={<Pencil />}
                permissions={["roles:update"]}
                disabledReason={lockedReason(role)}
                onClick={() => onEdit(role)}
              />
              <IconAction
                label={t("roles.actions.duplicate", { name })}
                icon={<Copy />}
                permissions={["roles:create"]}
                onClick={() => onDuplicate(role)}
              />
              <IconAction
                label={t("roles.actions.delete", { name })}
                icon={<Trash2 />}
                permissions={["roles:delete"]}
                disabledReason={lockedReason(role)}
                destructive
                onClick={() => onDelete(role)}
              />
            </div>
          );
        },
      }),
    ]);
  }, [t, tCommon, roleLabels, myRoleId, onEdit, onDuplicate, onDelete]);

  return <DataTable columns={columns} data={roles} />;
}
