import { collectTargets } from "@hacknation/contracts/targets/target-input";
import type {
  ImportTargetsBody,
  ImportTargetsResponse,
} from "@hacknation/contracts/targets/targets.schema";

import type { Prisma } from "~backend/generated/prisma/client";
import type { AuthContext } from "~backend/lib/auth-context";
import { chunks } from "~backend/lib/chunks";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { resolveDomains } from "~backend/modules/scans/dns";
import { scansService, type ScanTargetRow } from "~backend/modules/scans/scans.service";

const INSERT_BATCH = 2000;
// 100k targets plus their scan jobs take longer than Prisma's default 5 s.
const TRANSACTION_TIMEOUT_MS = 60_000;

async function findTargets(
  tx: Prisma.TransactionClient,
  values: readonly string[],
): Promise<ScanTargetRow[]> {
  const rows: ScanTargetRow[] = [];
  for (const batch of chunks(values, INSERT_BATCH)) {
    rows.push(
      ...(await tx.target.findMany({
        where: { value: { in: batch } },
        select: { id: true, kind: true, value: true },
      })),
    );
  }
  return rows;
}

export const targetsService = {
  /**
   * Adds new entries to the inventory (existing values are left as they are) and, with
   * `startScan`, queues a scan of every entry of this import.
   */
  async importTargets(auth: AuthContext, body: ImportTargetsBody): Promise<ImportTargetsResponse> {
    if (body.startScan && !auth.permissions.includes("scans:run")) {
      throw HttpError.forbidden("Missing permission: scans:run");
    }

    // validate() checked the body but never applies transforms: normalize here.
    const { entries } = collectTargets(
      body.entries.map((entry, index) => ({ position: index, value: entry.value, note: entry.note ?? "" })),
    );
    // Network I/O stays outside the transaction.
    const dns = body.startScan
      ? await resolveDomains(entries.filter((entry) => entry.kind === "domain").map((entry) => entry.value))
      : null;

    return prisma.$transaction(
      async (tx) => {
        let created = 0;
        for (const batch of chunks(entries, INSERT_BATCH)) {
          const result = await tx.target.createMany({
            data: batch.map((entry) => ({
              kind: entry.kind,
              value: entry.value,
              note: entry.note,
              createdById: auth.user.id,
            })),
            skipDuplicates: true,
          });
          created += result.count;
        }

        const queued = dns
          ? await scansService.queue(tx, auth, await findTargets(tx, entries.map((entry) => entry.value)), dns)
          : { scan: null, warnings: [] };

        return { received: entries.length, created, skipped: entries.length - created, ...queued };
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );
  },
};
