import { SYSTEM_ROLE_KEYS } from "@hacknation/contracts/auth/permissions";
import type {
  CreateRoleBody,
  DeleteRoleQuery,
  Role,
  RoleDetailResponse,
  UpdateRoleBody,
} from "@hacknation/contracts/roles/roles.schema";

import type { Role as RoleRow } from "~backend/generated/prisma/client";
import { assertHoldsAll, toPermissions, type AuthContext } from "~backend/lib/auth-context";
import { HttpError } from "~backend/lib/http-error";
import { isUniqueViolation, prisma } from "~backend/lib/prisma";
import { toRole } from "~backend/modules/roles/roles.mapper";

const withUserCount = { _count: { select: { users: true } } } as const;

/** System roles in the task's order, then custom roles by name. */
function rank(role: RoleRow): number {
  const index = SYSTEM_ROLE_KEYS.findIndex((key) => key === role.key);
  return index === -1 ? SYSTEM_ROLE_KEYS.length : index;
}

async function findRole(id: string) {
  const role = await prisma.role.findUnique({ where: { id }, include: withUserCount });
  if (!role) throw HttpError.notFound("Role not found");
  return role;
}

/** Shared by update and delete: the four system roles and your own role stay as they are. */
function assertEditable(auth: AuthContext, role: RoleRow): void {
  if (role.isSystem) {
    throw HttpError.forbidden("System roles are read-only", "SYSTEM_ROLE_READ_ONLY");
  }
  if (auth.role.id === role.id) {
    throw HttpError.forbidden("You cannot change your own role", "SELF_MODIFICATION");
  }
  assertHoldsAll(auth, role.permissions);
}

function nameTaken(error: unknown): never {
  if (isUniqueViolation(error)) {
    throw HttpError.conflict("A role with this name already exists", "ROLE_NAME_TAKEN");
  }
  throw error;
}

export const rolesService = {
  async list(): Promise<Role[]> {
    const roles = await prisma.role.findMany({ include: withUserCount });
    return roles
      .toSorted((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .map((role) => toRole(role, role._count.users));
  },

  async get(id: string): Promise<RoleDetailResponse> {
    const role = await prisma.role.findUnique({
      where: { id },
      include: {
        users: {
          select: { id: true, email: true, displayName: true, isActive: true },
          orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
        },
      },
    });
    if (!role) throw HttpError.notFound("Role not found");
    return { ...toRole(role, role.users.length), users: role.users };
  },

  async create(auth: AuthContext, body: CreateRoleBody): Promise<Role> {
    const permissions = toPermissions(body.permissions);
    assertHoldsAll(auth, permissions);

    const role = await prisma.role
      .create({
        data: {
          name: body.name.trim(),
          description: body.description.trim(),
          permissions,
        },
      })
      .catch(nameTaken);
    return toRole(role, 0);
  },

  async update(auth: AuthContext, id: string, body: UpdateRoleBody): Promise<Role> {
    const role = await findRole(id);
    assertEditable(auth, role);

    const permissions = body.permissions && toPermissions(body.permissions);
    if (permissions) assertHoldsAll(auth, permissions);

    const updated = await prisma.role
      .update({
        where: { id },
        data: { name: body.name?.trim(), description: body.description?.trim(), permissions },
      })
      .catch(nameTaken);
    return toRole(updated, role._count.users);
  },

  async delete(auth: AuthContext, id: string, query: DeleteRoleQuery): Promise<void> {
    const role = await findRole(id);
    assertEditable(auth, role);

    if (role._count.users === 0) {
      await prisma.role.delete({ where: { id } });
      return;
    }
    if (!query.reassignToRoleId) {
      throw HttpError.conflict(
        "Users still have this role; pass reassignToRoleId to move them",
        "ROLE_IN_USE",
      );
    }
    if (!auth.permissions.includes("users:update")) {
      throw HttpError.forbidden("Moving users to another role requires users:update");
    }
    if (query.reassignToRoleId === id) {
      throw HttpError.badRequest("Pick a different role to move the users to");
    }
    const target = await prisma.role.findUnique({ where: { id: query.reassignToRoleId } });
    if (!target) throw HttpError.badRequest("Role to move the users to was not found");
    assertHoldsAll(auth, target.permissions);

    await prisma.$transaction([
      prisma.user.updateMany({ where: { roleId: id }, data: { roleId: target.id } }),
      prisma.role.delete({ where: { id } }),
    ]);
  },
};
