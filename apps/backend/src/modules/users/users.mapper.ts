import type { User } from "@subsurf/contracts/users/users.schema";

import type { Role, User as UserRow } from "~backend/generated/prisma/client";
import { toRoleSummary } from "~backend/modules/roles/roles.mapper";

export function toUser(user: UserRow & { role: Role }): User {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: toRoleSummary(user.role),
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    lockedUntil: user.lockedUntil && user.lockedUntil > new Date() ? user.lockedUntil.toISOString() : null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
