// Demo scan data, run by `pnpm db:seed:hosts` after `pnpm db:seed` (or `pnpm db:reset`).
// Four runs over a /18 through the real ingest path; see "Demo data" in the backend README.
import { parseArgs } from "node:util";

import { seedDemoHosts } from "~backend/demo/seed";
import { loadDemoVulnerabilities } from "~backend/demo/vulnerabilities/load";
import { encryptLegacyRows } from "~backend/lib/encrypt-legacy";
import { logger } from "~backend/lib/logger";
import { prisma } from "~backend/lib/prisma";
import { rematch } from "~backend/modules/vulnerabilities/matching/matching.service";

const { values } = parseArgs({ options: { json: { type: "string" } } });

async function main(): Promise<void> {
  const admin = await prisma.user.findFirst({
    where: { isActive: true, role: { key: "admin" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!admin) {
    throw new Error(
      "No active admin to own the demo scans: run `pnpm db:reset` (or `pnpm db:seed`) first",
    );
  }

  // Notes written before they were encrypted would make the inventory unreadable.
  await encryptLegacyRows();
  const started = performance.now();
  await loadDemoVulnerabilities((message) => console.log(message));
  const summary = await seedDemoHosts(prisma, {
    requestedById: admin.id,
    jsonDir: values.json,
    log: (message) => console.log(message),
    // Matched after each run, so the second run's upgrades retract what they fixed.
    afterRun: async (run) => {
      const stats = await rematch("all", logger.child({ proc: "seed" }));
      console.log(
        `Run ${run.number} vulnerabilities: ${stats.added} matched, ${stats.retracted} retracted`,
      );
    },
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `Results: ${summary.results.ingested} ingested, ${summary.results.duplicate} already there. ` +
      `Inventory: ${summary.hosts} hosts, ${summary.services} services ` +
      `(${seconds} s, owner ${admin.email})`,
  );
  if (values.json) console.log(`Worker results written to ${values.json}`);
}

main()
  .catch((error: unknown) => {
    console.error("Demo seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
