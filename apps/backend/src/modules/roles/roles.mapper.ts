import { SystemRoleKeySchema } from "@hacknation/contracts/auth/permissions";
import type { Role, RoleSummary } from "@hacknation/contracts/roles/roles.schema";

import type { Role as RoleRow } from "~backend/generated/prisma/client";
import { toPermissions } from "~backend/lib/auth-context";

export function toRoleSummary(role: RoleRow): RoleSummary {
  const key = SystemRoleKeySchema.safeParse(role.key);
  return { id: role.id, key: key.success ? key.data : null, name: role.name };
}

export function toRole(role: RoleRow, userCount: number): Role {
  return {
    ...toRoleSummary(role),
    description: role.description,
    isSystem: role.isSystem,
    permissions: toPermissions(role.permissions),
    userCount,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}
