// The vulnerability sync process (`pnpm vulns:sync`): mirrors the vulnerability databases and
// re-matches services, separately from the API so large downloads never slow requests down.
//   (no command)          run until stopped: API requests, syncs every few hours, new scan results
//   --once [--source id] [--full] [--rematch]   one pass, then exit
//   mirror <dir>          download every source's files into <dir> for an offline lab (no database)
//   import --source id <file>                   import a file in the source's own format
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { env } from "~backend/config/env";
import { logger } from "~backend/lib/logger";
import { prisma } from "~backend/lib/prisma";
import { rematch } from "~backend/modules/vulnerabilities/matching/matching.service";
import { createFetcher } from "~backend/modules/vulnerabilities/sources/fetcher";
import {
  configuredSources,
  ensureSources,
  sourceById,
} from "~backend/modules/vulnerabilities/sources/registry";
import type { VulnerabilitySource } from "~backend/modules/vulnerabilities/sources/source";
import {
  acquireLease,
  keepLease,
  releaseLease,
} from "~backend/modules/vulnerabilities/sync/lease";
import { writeRecords } from "~backend/modules/vulnerabilities/sync/records";
import { VulnerabilityScheduler } from "~backend/modules/vulnerabilities/sync/scheduler";
import { markInterruptedRuns } from "~backend/modules/vulnerabilities/sync/sync.service";

const log = logger.child({ proc: "vuln-sync" });
const holder = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    once: { type: "boolean", default: false },
    full: { type: "boolean", default: false },
    rematch: { type: "boolean", default: false },
    source: { type: "string" },
  },
});

const controller = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    log.info({ signal }, "Stopping");
    controller.abort(new Error(`Stopped by ${signal}`));
  });
}

function pickSources(): VulnerabilitySource[] {
  if (!values.source) return configuredSources();
  const source = sourceById(values.source);
  if (!source) throw new Error(`Unknown or unconfigured source: ${values.source}`);
  return [source];
}

const fetcher = (cacheDir = env.VULN_CACHE_DIR) =>
  createFetcher({ cacheDir: resolve(cacheDir), allowNetwork: env.NODE_ENV !== "test" });

async function withLease(work: () => Promise<void>): Promise<void> {
  if (!(await acquireLease(holder))) {
    throw new Error("Another vuln-sync process is working (it holds the lease); try again later");
  }
  // A full sync takes minutes: renew the lease meanwhile, or the run loses it halfway.
  const stopRenewing = keepLease(holder, controller, log);
  try {
    await ensureSources();
    await markInterruptedRuns();
    await work();
  } finally {
    stopRenewing();
    await releaseLease(holder);
  }
}

async function once(): Promise<void> {
  await withLease(async () => {
    const scheduler = new VulnerabilityScheduler({ holder, fetcher: fetcher(), log });
    if (!values.rematch || values.source || values.full) {
      for (const source of pickSources()) {
        const outcome = await scheduler.syncSource(
          source,
          values.full ? "full" : "incremental",
          "cli",
          controller.signal,
        );
        log.info({ source: source.id, ...outcome }, "Sync finished");
        if (outcome.status !== "succeeded") process.exitCode = 1;
      }
    } else {
      log.info(await rematch("all", log), "Services re-matched");
    }
  });
}

async function mirror(dir: string | undefined): Promise<void> {
  if (!dir) throw new Error("Usage: pnpm vulns:mirror <dir>");
  const target = fetcher(dir);
  for (const source of pickSources()) {
    let records = 0;
    for await (const event of source.sync({
      mode: "full",
      cursor: null,
      signal: controller.signal,
      fetcher: target,
      log,
      now: new Date(),
    })) {
      if (event.type === "upsert") records++;
    }
    log.info({ source: source.id, records, dir: resolve(dir) }, "Mirrored");
  }
  log.info(
    `Offline: NVD_FEED_URL=file://${resolve(dir, "nvd")} ` +
      `OSV_BASE_URL=file://${resolve(dir, "osv")}`,
  );
}

async function importFile(path: string | undefined): Promise<void> {
  const source = values.source ? sourceById(values.source) : undefined;
  if (!source || !path) throw new Error("Usage: pnpm vulns:import --source <id> <file>");
  await withLease(async () => {
    const stats = await writeRecords(
      source.id,
      source.importFile(resolve(path), controller.signal),
      new Date(),
    );
    log.info({ source: source.id, ...stats }, "Imported");
    log.info(await rematch("all", log), "Services re-matched");
  });
}

async function main(): Promise<void> {
  const [command, argument] = positionals;
  if (command === "mirror") return mirror(argument);
  if (command === "import") return importFile(argument);
  if (command !== undefined) throw new Error(`Unknown command: ${command}`);
  if (values.once || values.rematch) return once();

  log.info({ holder, sources: configuredSources().map((source) => source.id) }, "Started");
  await new VulnerabilityScheduler({ holder, fetcher: fetcher(), log }).run(controller.signal);
}

main()
  .catch((error: unknown) => {
    log.error({ err: error }, "vuln-sync failed");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
