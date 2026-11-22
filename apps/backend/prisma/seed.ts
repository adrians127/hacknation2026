// Local development seed, run by `pnpm db:seed` / `pnpm db:reset`. Idempotent.
import { z } from "zod";

import { env } from "~backend/config/env";
import { Prisma } from "~backend/generated/prisma/client";
import { prisma } from "~backend/lib/prisma";
import { defaultSteps } from "~backend/modules/pipelines/steps";
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

const DEFAULT_PIPELINE_NAME = "Default discovery";

/**
 * masscan over the whole inventory, then nmap on its hits, with the env defaults; no schedule.
 * Workers are registered by worker-manager, so on a fresh database this waits for a reseed after
 * a manager has polled.
 */
async function ensureDefaultPipeline(ownerEmail: string): Promise<string> {
  if (await prisma.pipeline.findUnique({ where: { name: DEFAULT_PIPELINE_NAME } })) return "exists";
  const { steps, missing } = await defaultSteps(prisma);
  if (missing.length > 0) return `skipped (no worker manager has registered ${missing.join(", ")} yet)`;
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: ownerEmail.toLowerCase() } });
  await prisma.pipeline.create({
    data: {
      name: DEFAULT_PIPELINE_NAME,
      description: "Masscan over every target, then Nmap on the open ports it found.",
      createdById: owner.id,
      steps: {
        create: steps.map((step) => ({
          position: step.index,
          workerId: step.workerId,
          input: step.input,
          targetSelector: step.input === "targets" ? { tags: [], targetIds: [], ranges: [] } : Prisma.DbNull,
          ports: step.ports,
          rate: step.rate,
          batchSize: step.batchSize,
          maxDurationSeconds: step.maxDurationSeconds,
          split: step.split,
          params: {},
        })),
      },
    },
  });
  return "created";
}

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
    console.log(`Pipeline "${DEFAULT_PIPELINE_NAME}": ${await ensureDefaultPipeline(env.ADMIN_EMAIL)}`);
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
