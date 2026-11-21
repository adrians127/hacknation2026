import type {
  CreateUserBody,
  UpdateUserBody,
  User,
  UserWithTemporaryPasswordResponse,
} from "@hacknation/contracts/users/users.schema";

import type { Role, User as UserRow } from "~backend/generated/prisma/client";
import { assertHoldsAll, type AuthContext } from "~backend/lib/auth-context";
import { HttpError } from "~backend/lib/http-error";
import { generateTemporaryPassword, hashPassword } from "~backend/lib/password";
import { isUniqueViolation, prisma } from "~backend/lib/prisma";
import { normalizeEmail, revokeSessions } from "~backend/modules/auth/auth.service";
import { toUser } from "~backend/modules/users/users.mapper";

type UserWithRole = UserRow & { role: Role };

async function findUser(id: string): Promise<UserWithRole> {
  const user = await prisma.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw HttpError.notFound("User not found");
  return user;
}

async function findAssignableRole(roleId: string): Promise<Role> {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw HttpError.badRequest("Role not found");
  return role;
}

function assertNotSelf(auth: AuthContext, userId: string): void {
  if (auth.user.id === userId) {
    throw HttpError.forbidden("You cannot do this to your own account", "SELF_MODIFICATION");
  }
}

/** The system must never lose its last way into user and role management. */
async function assertNotLastAdmin(user: UserWithRole): Promise<void> {
  if (user.role.key !== "admin" || !user.isActive) return;
  const otherAdmins = await prisma.user.count({
    where: { id: { not: user.id }, isActive: true, role: { key: "admin" } },
  });
  if (otherAdmins === 0) {
    throw HttpError.conflict("At least one active admin must remain", "LAST_ADMIN");
  }
}

async function issueTemporaryPassword() {
  const temporaryPassword = generateTemporaryPassword();
  return { temporaryPassword, passwordHash: await hashPassword(temporaryPassword) };
}

export const usersService = {
  async list(): Promise<User[]> {
    const users = await prisma.user.findMany({
      include: { role: true },
      orderBy: [{ isActive: "desc" }, { displayName: "asc" }],
    });
    return users.map(toUser);
  },

  async get(id: string): Promise<User> {
    return toUser(await findUser(id));
  },

  async create(auth: AuthContext, body: CreateUserBody): Promise<UserWithTemporaryPasswordResponse> {
    const role = await findAssignableRole(body.roleId);
    assertHoldsAll(auth, role.permissions);

    const { temporaryPassword, passwordHash } = await issueTemporaryPassword();
    try {
      const user = await prisma.user.create({
        data: {
          email: normalizeEmail(body.email),
          displayName: body.displayName.trim(),
          passwordHash,
          roleId: role.id,
          mustChangePassword: true,
        },
        include: { role: true },
      });
      return { user: toUser(user), temporaryPassword };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw HttpError.conflict("A user with this email already exists", "EMAIL_TAKEN");
      }
      throw error;
    }
  },

  async update(auth: AuthContext, id: string, body: UpdateUserBody): Promise<User> {
    const user = await findUser(id);
    assertHoldsAll(auth, user.role.permissions);

    let roleId: string | undefined;
    if (body.roleId !== undefined && body.roleId !== user.roleId) {
      assertNotSelf(auth, user.id);
      const role = await findAssignableRole(body.roleId);
      assertHoldsAll(auth, role.permissions);
      if (role.key !== "admin") await assertNotLastAdmin(user);
      roleId = role.id;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { displayName: body.displayName?.trim(), roleId },
      include: { role: true },
    });
    return toUser(updated);
  },

  async resetPassword(auth: AuthContext, id: string): Promise<UserWithTemporaryPasswordResponse> {
    const user = await findUser(id);
    // Your own password goes through /auth/change-password, which checks the current one.
    assertNotSelf(auth, user.id);
    assertHoldsAll(auth, user.role.permissions);

    const { temporaryPassword, passwordHash } = await issueTemporaryPassword();
    const updated = await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
      },
      include: { role: true },
    });
    await revokeSessions(id);
    return { user: toUser(updated), temporaryPassword };
  },

  async deactivate(auth: AuthContext, id: string): Promise<User> {
    const user = await findUser(id);
    assertNotSelf(auth, user.id);
    assertHoldsAll(auth, user.role.permissions);
    await assertNotLastAdmin(user);

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: false },
      include: { role: true },
    });
    await revokeSessions(id);
    return toUser(updated);
  },

  async reactivate(auth: AuthContext, id: string): Promise<User> {
    const user = await findUser(id);
    assertHoldsAll(auth, user.role.permissions);

    const updated = await prisma.user.update({
      where: { id },
      data: { isActive: true, failedLoginCount: 0, lockedUntil: null },
      include: { role: true },
    });
    return toUser(updated);
  },
};
