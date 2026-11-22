import { afterAll, beforeEach } from "vitest";

import { prisma } from "~backend/lib/prisma";
import { syncSystemRoles } from "~backend/modules/roles/system-roles";
import { syncWorkerCatalog } from "~backend/modules/workers/worker-catalog.sync";

// Every test starts from empty tables; files run one at a time (fileParallelism: false).
beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
  }
  await syncSystemRoles();
  await syncWorkerCatalog();
});

afterAll(async () => {
  await prisma.$disconnect();
});
