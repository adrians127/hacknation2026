import { KeyRound, Pencil, UserCheck, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { User } from "@hacknation/contracts/users/users.schema";

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

interface UsersTableProps {
  users: User[];
  onEdit: (user: User) => void;
  onResetPassword: (user: User) => void;
  onDeactivate: (user: User) => void;
  onReactivate: (user: User) => void;
}

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
  const me = useMe();
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  if (users.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("users.empty")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("users.columns.user")}</TableHead>
            <TableHead>{t("users.columns.role")}</TableHead>
            <TableHead>{t("users.columns.status")}</TableHead>
            <TableHead>{t("users.columns.lastLogin")}</TableHead>
            <TableHead className="text-right">{t("users.columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const isMe = user.id === me.id;
            const name = user.displayName;
            const selfReason = isMe ? tCommon("errors.SELF_MODIFICATION") : undefined;
            return (
              <TableRow key={user.id} className={user.isActive ? undefined : "opacity-60"}>
                <TableCell>
                  <div className="font-medium">
                    {name}
                    {isMe && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({t("users.you")})
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">{user.email}</div>
                </TableCell>
                <TableCell>{roleLabels.name(user.role)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={user.isActive ? "secondary" : "outline"}>
                      {user.isActive ? t("users.status.active") : t("users.status.inactive")}
                    </Badge>
                    {user.lockedUntil && (
                      <Badge variant="destructive">{t("users.status.locked")}</Badge>
                    )}
                    {user.mustChangePassword && (
                      <Badge variant="outline">{t("users.status.mustChangePassword")}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {user.lastLoginAt
                    ? dateFormat.format(new Date(user.lastLoginAt))
                    : t("users.neverSignedIn")}
                </TableCell>
                <TableCell>
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
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
