import { Copy, Eye, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { Role } from "@hacknation/contracts/roles/roles.schema";

import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRoleLabels } from "@/lib/auth/labels";
import { useMe } from "@/lib/auth/me-query";

interface RolesTableProps {
  roles: Role[];
  onEdit: (role: Role) => void;
  onDuplicate: (role: Role) => void;
  onDelete: (role: Role) => void;
}

export function RolesTable({ roles, onEdit, onDuplicate, onDelete }: RolesTableProps) {
  const { t } = useTranslation("admin");
  const { t: tCommon } = useTranslation();
  const roleLabels = useRoleLabels();
  const me = useMe();

  const lockedReason = (role: Role) => {
    if (role.isSystem) return tCommon("errors.SYSTEM_ROLE_READ_ONLY");
    if (role.id === me.role.id) return tCommon("errors.SELF_MODIFICATION");
    return undefined;
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("roles.columns.name")}</TableHead>
            <TableHead className="text-right">{t("roles.columns.users")}</TableHead>
            <TableHead className="text-right">{t("roles.columns.permissions")}</TableHead>
            <TableHead className="text-right">{t("roles.columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => {
            const name = roleLabels.name(role);
            return (
              <TableRow key={role.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/admin/roles/${role.id}`} className="font-medium hover:underline">
                      {name}
                    </Link>
                    <Badge variant={role.isSystem ? "secondary" : "outline"}>
                      {role.isSystem ? t("roles.system") : t("roles.custom")}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{roleLabels.description(role)}</p>
                </TableCell>
                <TableCell className="text-right tabular-nums">{role.userCount}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {t("roles.permissionCount", { count: role.permissions.length })}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <IconAction
                      label={t("roles.actions.view", { name })}
                      icon={<Eye />}
                      to={`/admin/roles/${role.id}`}
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
