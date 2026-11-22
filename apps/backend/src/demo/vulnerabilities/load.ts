import { fileURLToPath } from "node:url";

import { prisma } from "~backend/lib/prisma";
import { ensureSources, sourceById } from "~backend/modules/vulnerabilities/sources/registry";
import { writeRecords } from "~backend/modules/vulnerabilities/sync/records";

/** Real records for the demo network's software, in each source's own format (build-fixture.ts). */
const FIXTURES: Record<string, string> = { nvd: "nvd.json", osv: "osv.json" };

/**
 * Loads the demo slice of the vulnerability databases through the sources' parsers, so the demo
 * shows matches without a sync. No cursor and no `lastFullAt`: the first real sync still does a
 * full import.
 */
export async function loadDemoVulnerabilities(log: (message: string) => void): Promise<void> {
  await ensureSources();
  const signal = new AbortController().signal;
  for (const [sourceId, file] of Object.entries(FIXTURES)) {
    const source = sourceById(sourceId);
    if (!source) continue;
    const path = fileURLToPath(new URL(`./${file}`, import.meta.url));
    const stats = await writeRecords(sourceId, source.importFile(path, signal), new Date());
    const recordCount = await prisma.vulnerability.count({ where: { sourceId, status: "active" } });
    await prisma.vulnerabilitySource.update({ where: { id: sourceId }, data: { recordCount } });
    log(`Vulnerabilities from ${source.displayName}: ${stats.upserted} new or changed records`);
  }
}
