import type { SystemRoleKey } from "@subsurf/contracts/auth/permissions";

import { env } from "~backend/config/env";
import { hashPassword } from "~backend/lib/password";
import { prisma } from "~backend/lib/prisma";
import { normalizeEmail } from "~backend/modules/auth/auth.service";

export interface SeedUser {
  email: string;
  displayName: string;
  password: string;
  role: SystemRoleKey;
}

/** Creates the user unless the email exists; never overwrites an existing password. */
export async function ensureUser(seed: SeedUser): Promise<"created" | "exists"> {
  const email = normalizeEmail(seed.email);
  if (await prisma.user.findUnique({ where: { email } })) return "exists";

  const role = await prisma.role.findUniqueOrThrow({ where: { key: seed.role } });
  await prisma.user.create({
    data: {
      email,
      displayName: seed.displayName,
      passwordHash: await hashPassword(seed.password),
      roleId: role.id,
    },
  });
  return "created";
}

/**
 * First run without the seed (e.g. the Docker image, which has no tsx): create
 * the admin from ADMIN_EMAIL / ADMIN_PASSWORD, but only while there are no users.
 */
export async function bootstrapAdmin(): Promise<boolean> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return false;
  if ((await prisma.user.count()) > 0) return false;

  const result = await ensureUser({
    email: env.ADMIN_EMAIL,
    displayName: "Administrator",
    password: env.ADMIN_PASSWORD,
    role: "admin",
  });
  return result === "created";
}
