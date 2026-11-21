import {
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_PERMISSIONS,
  type SystemRoleKey,
} from "@subsurf/contracts/auth/permissions";

import { toPermissions } from "~backend/lib/auth-context";
import { prisma } from "~backend/lib/prisma";

// English names and the task's wording (section 2, item 13); the UI translates them by key.
const SYSTEM_ROLES: Record<SystemRoleKey, { name: string; description: string }> = {
  admin: { name: "Admin", description: "Administration" },
  editor: { name: "Editor", description: "Create, delete and modify" },
  analyst: { name: "Analyst", description: "Modify and read" },
  viewer: { name: "Viewer", description: "Read" },
};

/**
 * Makes the database match the code: the four system roles get exactly their
 * permissions from contracts, and custom roles lose permissions that no longer
 * exist. Idempotent; runs at startup and in the seed, so a new permission
 * reaches the system roles with a plain deploy.
 */
export async function syncSystemRoles(): Promise<void> {
  for (const key of SYSTEM_ROLE_KEYS) {
    const data = {
      ...SYSTEM_ROLES[key],
      isSystem: true,
      permissions: [...SYSTEM_ROLE_PERMISSIONS[key]],
    };
    await prisma.role.upsert({ where: { key }, create: { key, ...data }, update: data });
  }

  const customRoles = await prisma.role.findMany({ where: { isSystem: false } });
  for (const role of customRoles) {
    const known = toPermissions(role.permissions);
    if (known.length !== role.permissions.length) {
      await prisma.role.update({ where: { id: role.id }, data: { permissions: known } });
    }
  }
}
