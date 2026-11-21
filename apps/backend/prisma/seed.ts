// Local development seed, run by `pnpm db:seed` / `pnpm db:reset`. Idempotent.
import { z } from "zod";

import { env } from "~backend/config/env";
import { prisma } from "~backend/lib/prisma";
import { syncSystemRoles } from "~backend/modules/roles/system-roles";
import { ensureUser } from "~backend/modules/users/bootstrap";

const seedEnv = z
  .object({
    SEED_DEMO_USERS: z.stringbool().default(false),
    DEMO_USER_PASSWORD: z.string().min(12).optional(),
  })
  .parse(process.env);

const DEMO_USERS = [
  { email: "editor@hacknation.local", displayName: "Demo Editor", role: "editor" },
  { email: "analyst@hacknation.local", displayName: "Demo Analyst", role: "analyst" },
  { email: "viewer@hacknation.local", displayName: "Demo Viewer", role: "viewer" },
] as const;

async function main(): Promise<void> {
  await syncSystemRoles();
  console.log("System roles: admin, editor, analyst, viewer");

  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD) {
    const result = await ensureUser({
      email: env.ADMIN_EMAIL,
      displayName: "Administrator",
      password: env.ADMIN_PASSWORD,
      role: "admin",
    });
    console.log(`Admin ${env.ADMIN_EMAIL}: ${result}`);
  } else {
    console.warn("ADMIN_EMAIL / ADMIN_PASSWORD not set: no admin account seeded");
  }

  if (!seedEnv.SEED_DEMO_USERS) return;
  if (env.NODE_ENV === "production") {
    console.warn("SEED_DEMO_USERS is ignored in production");
    return;
  }
  if (!seedEnv.DEMO_USER_PASSWORD) {
    throw new Error("SEED_DEMO_USERS=true needs DEMO_USER_PASSWORD (at least 12 characters)");
  }
  for (const user of DEMO_USERS) {
    const result = await ensureUser({ ...user, password: seedEnv.DEMO_USER_PASSWORD });
    console.log(`Demo ${user.email} (${user.role}): ${result}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
