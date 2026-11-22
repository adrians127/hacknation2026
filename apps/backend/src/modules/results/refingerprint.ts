import type { PrismaClient } from "~backend/generated/prisma/client";
import { storedOpenPort } from "~backend/modules/results/details";
import { portFingerprint } from "~backend/modules/results/fingerprint";

const BATCH_SIZE = 500;

/**
 * Recomputes `PortObservation.fingerprint` from the stored columns and decrypted details, after
 * `comparable.ts` changes what counts as a change. Without it, old and new observations of the
 * same unchanged port would differ.
 */
export async function refingerprintPorts(
  prisma: PrismaClient,
): Promise<{ checked: number; updated: number }> {
  let checked = 0;
  let updated = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.portObservation.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) break;
    cursor = rows.at(-1)?.id;
    checked += rows.length;
    const stale = rows.flatMap((row) => {
      const fingerprint = portFingerprint(storedOpenPort(row));
      return fingerprint === row.fingerprint ? [] : [{ id: row.id, fingerprint }];
    });
    updated += stale.length;
    await prisma.$transaction(
      stale.map(({ id, fingerprint }) =>
        prisma.portObservation.update({ where: { id }, data: { fingerprint } }),
      ),
    );
  }
  return { checked, updated };
}
