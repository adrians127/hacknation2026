import type { Logger } from "pino";

import { prisma } from "~backend/lib/prisma";

const STATE_ID = 1;

/** How long a lease lasts without renewal; the holder renews it every `LEASE_RENEW_MS`. */
export const LEASE_SECONDS = 180;
export const LEASE_RENEW_MS = 60_000;

export class LeaseLostError extends Error {
  constructor(holder: string) {
    super(`The vulnerability sync lease is no longer held by ${holder}`);
  }
}

async function ensureStateRow(): Promise<void> {
  await prisma.vulnerabilitySyncState.createMany({
    data: [{ id: STATE_ID }],
    skipDuplicates: true,
  });
}

/**
 * One vuln-sync process works at a time. Times come from the database clock, so hosts with
 * skewed clocks still agree on expiry.
 */
export async function acquireLease(holder: string): Promise<boolean> {
  await ensureStateRow();
  const updated = await prisma.$executeRaw`
    UPDATE "VulnerabilitySyncState"
    SET "lockedBy" = ${holder},
        "lockExpiresAt" = now() + make_interval(secs => ${LEASE_SECONDS}),
        "updatedAt" = now()
    WHERE id = ${STATE_ID}
      AND ("lockedBy" IS NULL OR "lockedBy" = ${holder} OR "lockExpiresAt" < now())`;
  return updated === 1;
}

export async function renewLease(holder: string): Promise<boolean> {
  const updated = await prisma.$executeRaw`
    UPDATE "VulnerabilitySyncState"
    SET "lockExpiresAt" = now() + make_interval(secs => ${LEASE_SECONDS}), "updatedAt" = now()
    WHERE id = ${STATE_ID} AND "lockedBy" = ${holder} AND "lockExpiresAt" > now()`;
  return updated === 1;
}

/**
 * Renews the lease every `LEASE_RENEW_MS` while work runs; losing it aborts `controller` (the
 * work stops at its next check instead of writing as a second holder). Returns the stop function.
 */
export function keepLease(
  holder: string,
  controller: AbortController,
  log: Logger,
  everyMs = LEASE_RENEW_MS,
): () => void {
  const timer = setInterval(() => {
    renewLease(holder)
      .then((held) => {
        if (!held) {
          log.warn("Lost the vulnerability sync lease");
          controller.abort(new LeaseLostError(holder));
        }
      })
      .catch((error: unknown) => log.error({ err: error }, "Lease renewal failed"));
  }, everyMs);
  return () => clearInterval(timer);
}

export async function releaseLease(holder: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "VulnerabilitySyncState"
    SET "lockedBy" = NULL, "lockExpiresAt" = NULL, "updatedAt" = now()
    WHERE id = ${STATE_ID} AND "lockedBy" = ${holder}`;
}

/** Throws unless `holder` still holds the lease: guards writes of cursors and sweeps. */
export async function assertLease(holder: string): Promise<void> {
  const rows = await prisma.$queryRaw<{ held: boolean }[]>`
    SELECT ("lockedBy" = ${holder} AND "lockExpiresAt" > now()) AS held
    FROM "VulnerabilitySyncState" WHERE id = ${STATE_ID}`;
  if (!rows[0]?.held) throw new LeaseLostError(holder);
}

/** Whether any process holds a live lease (the admin panel shows it). */
export async function leaseActive(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ active: boolean }[]>`
    SELECT ("lockedBy" IS NOT NULL AND "lockExpiresAt" > now()) AS active
    FROM "VulnerabilitySyncState" WHERE id = ${STATE_ID}`;
  return rows[0]?.active ?? false;
}

export async function readResultCursor(): Promise<Date | null> {
  await ensureStateRow();
  const state = await prisma.vulnerabilitySyncState.findUniqueOrThrow({ where: { id: STATE_ID } });
  return state.resultCursor;
}

export async function writeResultCursor(holder: string, cursor: Date): Promise<void> {
  await prisma.vulnerabilitySyncState.updateMany({
    where: { id: STATE_ID, lockedBy: holder },
    data: { resultCursor: cursor },
  });
}
