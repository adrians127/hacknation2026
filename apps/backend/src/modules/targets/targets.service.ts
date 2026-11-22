import { collectTargets } from "@subsurf/contracts/targets/target-input";
import type {
  ImportTargetsBody,
  ImportTargetsResponse,
  Target,
  UpdateTargetBody,
} from "@subsurf/contracts/targets/targets.schema";

import { Prisma } from "~backend/generated/prisma/client";
import type { AuthContext } from "~backend/lib/auth-context";
import { chunks } from "~backend/lib/chunks";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { resolveDomains } from "~backend/modules/scans/dns";
import { scansService, type ScanTargetRow } from "~backend/modules/scans/scans.service";
import { toTarget, type TargetRow } from "~backend/modules/targets/targets.mapper";

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

/**
 * Targets with their newest started scan and the addresses up in it. A host is up when any
 * worker saw it up (as `effectiveSql` in scan results); a domain counts the addresses it was
 * scanned under.
 */
function targetRows(id?: string): Promise<TargetRow[]> {
  const onlyTarget = (column: Prisma.Sql) => (id ? Prisma.sql`AND ${column} = ${id}::uuid` : Prisma.empty);
  return prisma.$queryRaw<TargetRow[]>`
    WITH latest AS (
      SELECT DISTINCT ON (st."targetId") st."targetId", s.id AS "scanId", s."startedAt"
      FROM "ScanTarget" st
      JOIN "Scan" s ON s.id = st."scanId"
      WHERE s."startedAt" IS NOT NULL ${onlyTarget(Prisma.sql`st."targetId"`)}
      ORDER BY st."targetId", s."startedAt" DESC
    )
    SELECT t.id, t.kind, t.value, t.note, t.tags, t."createdAt", l."startedAt" AS "lastScanAt",
      CASE
        WHEN l."scanId" IS NULL THEN 0
        WHEN t.kind = 'domain' THEN (
          SELECT count(DISTINCT h.ip)::int
          FROM "HostObservation" h
          JOIN "HostnameObservation" n ON n."hostObservationId" = h.id
          WHERE h."scanId" = l."scanId" AND h.status = 'up' AND n.name = t.value
        )
        ELSE (
          SELECT count(DISTINCT h.ip)::int
          FROM "HostObservation" h
          WHERE h."scanId" = l."scanId" AND h.status = 'up'
            AND h."ipNumber" BETWEEN network(t.value::inet) - '0.0.0.0'::inet
                                 AND broadcast(t.value::inet) - '0.0.0.0'::inet
        )
      END AS "activeHosts"
    FROM "Target" t
    LEFT JOIN latest l ON l."targetId" = t.id
    WHERE true ${onlyTarget(Prisma.sql`t.id`)}
    ORDER BY t.value
  `;
}

async function getTarget(id: string): Promise<Target> {
  const [row] = await targetRows(id);
  if (!row) throw HttpError.notFound("Target not found");
  return toTarget(row);
}

export const targetsService = {
  async list(): Promise<Target[]> {
    return (await targetRows()).map(toTarget);
  },

  async update(id: string, body: UpdateTargetBody): Promise<Target> {
    const { count } = await prisma.target.updateMany({
      where: { id },
      data: {
        ...(body.note !== undefined && { note: body.note }),
        ...(body.tags !== undefined && { tags: [...new Set(body.tags.map((tag) => tag.trim()))] }),
      },
    });
    if (count === 0) throw HttpError.notFound("Target not found");
    return getTarget(id);
  },

  /** Its `ScanTarget` links go with it; the scans keep their jobs and results. */
  async remove(id: string): Promise<void> {
    const { count } = await prisma.target.deleteMany({ where: { id } });
    if (count === 0) throw HttpError.notFound("Target not found");
  },

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
              tags: body.tags ?? [],
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
