import { z } from "zod";

import { ipv4ToInt } from "@subsurf/contracts/targets/ipv4";
import { collectTargets, type TargetKind } from "@subsurf/contracts/targets/target-input";
import type {
  ImportTargetsBody,
  ImportTargetsResponse,
  Target,
  TargetListQuery,
  TargetListResponse,
  UpdateTargetBody,
} from "@subsurf/contracts/targets/targets.schema";

import { Prisma } from "~backend/generated/prisma/client";
import type { AuthContext } from "~backend/lib/auth-context";
import { chunks } from "~backend/lib/chunks";
import { decryptText, encryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { escapeLike } from "~backend/lib/like";
import { prisma } from "~backend/lib/prisma";
import { normalizeTags } from "~backend/lib/tags";
import { resolveDomains } from "~backend/modules/scans/dns";
import { scansService, type ScanTargetRow } from "~backend/modules/scans/scans.service";
import { targetRow } from "~backend/modules/targets/target-row";

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

interface TargetListRow {
  id: string;
  kind: TargetKind;
  value: string;
  note: unknown;
  tags: string[];
  createdAt: Date;
  rangeStart: bigint | null;
  rangeEnd: bigint | null;
}

/** The newest scan with results that covered a target, and what it found there. */
interface TargetUsage {
  scanId: string;
  scanAt: Date;
  activeHosts: number;
}

const COLUMNS = Prisma.sql`t.id, t.kind, t.value, t.note, t.tags, t."createdAt", t."rangeStart", t."rangeEnd"`;

function filterSql({ q, kind, tag }: Pick<TargetListQuery, "q" | "kind" | "tag">): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];
  if (kind) conditions.push(Prisma.sql`t.kind = ${kind}::"TargetKind"`);
  if (tag) conditions.push(Prisma.sql`${tag} = ANY(t.tags)`);
  const term = q?.trim();
  if (term) {
    // An address also finds the blocks that hold it, which no text match would.
    const address = z.ipv4().safeParse(term).success ? BigInt(ipv4ToInt(term)) : null;
    const holds =
      address === null
        ? Prisma.empty
        : Prisma.sql`OR (t."rangeStart" <= ${address} AND t."rangeEnd" >= ${address})`;
    conditions.push(
      Prisma.sql`(t.value ILIKE ${`%${escapeLike(term)}%`} OR ${term} = ANY(t.tags) ${holds})`,
    );
  }
  return conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
}

/** One query for the page's last scans, then one per kind of target for the hosts up in them. */
async function usageOf(rows: readonly TargetListRow[]): Promise<Map<string, TargetUsage>> {
  if (rows.length === 0) return new Map();
  const scans = await prisma.$queryRaw<{ targetId: string; scanId: string; scanAt: Date }[]>`
    SELECT DISTINCT ON (st."targetId") st."targetId", s.id AS "scanId",
           coalesce(s."startedAt", s."createdAt") AS "scanAt"
    FROM "ScanTarget" st
    JOIN "Scan" s ON s.id = st."scanId"
    WHERE st."targetId" = ANY(${rows.map((row) => row.id)}::uuid[])
      AND EXISTS (SELECT 1 FROM "ScanJobResult" r WHERE r."scanId" = s.id)
    ORDER BY st."targetId", s."createdAt" DESC`;
  const lastScan = new Map(scans.map((scan) => [scan.targetId, scan]));
  const scanned = rows.flatMap((row) => {
    const scan = lastScan.get(row.id);
    return scan ? [{ row, scanId: scan.scanId }] : [];
  });
  const ranged = scanned.flatMap(({ row, scanId }) =>
    row.rangeStart === null || row.rangeEnd === null
      ? []
      : [Prisma.sql`(${row.id}::uuid, ${scanId}::uuid, ${row.rangeStart}::bigint, ${row.rangeEnd}::bigint)`],
  );
  const named = scanned.flatMap(({ row, scanId }) =>
    row.kind === "domain" ? [Prisma.sql`(${row.id}::uuid, ${scanId}::uuid, ${row.value})`] : [],
  );

  type Counted = { id: string; activeHosts: number }[];
  const [inRanges, underNames] = await Promise.all([
    ranged.length === 0
      ? []
      : prisma.$queryRaw<Counted>`
          SELECT t.id, count(DISTINCT ho.ip)::int AS "activeHosts"
          FROM (VALUES ${Prisma.join(ranged)}) AS t(id, "scanId", lo, hi)
          JOIN "HostObservation" ho
            ON ho."scanId" = t."scanId" AND ho.status = 'up' AND ho."ipNumber" BETWEEN t.lo AND t.hi
          GROUP BY t.id`,
    named.length === 0
      ? []
      : prisma.$queryRaw<Counted>`
          SELECT t.id, count(DISTINCT ho.ip)::int AS "activeHosts"
          FROM (VALUES ${Prisma.join(named)}) AS t(id, "scanId", name)
          JOIN "HostnameObservation" hn ON hn.name = t.name
          JOIN "HostObservation" ho
            ON ho.id = hn."hostObservationId" AND ho."scanId" = t."scanId" AND ho.status = 'up'
          GROUP BY t.id`,
  ]);
  const active = new Map([...inRanges, ...underNames].map((row) => [row.id, row.activeHosts]));
  return new Map(
    scans.map((scan) => [
      scan.targetId,
      { scanId: scan.scanId, scanAt: scan.scanAt, activeHosts: active.get(scan.targetId) ?? 0 },
    ]),
  );
}

function toTarget(row: TargetListRow, usage: TargetUsage | undefined): Target {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    note: decryptText(row.note),
    tags: row.tags,
    activeHosts: usage?.activeHosts ?? 0,
    lastScanId: usage?.scanId ?? null,
    lastScanAt: usage?.scanAt.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function findTarget(id: string): Promise<Target> {
  const rows = await prisma.$queryRaw<TargetListRow[]>`
    SELECT ${COLUMNS} FROM "Target" t WHERE t.id = ${id}::uuid`;
  const [row] = rows;
  if (!row) throw HttpError.notFound("Target not found");
  return toTarget(row, (await usageOf(rows)).get(row.id));
}

export const targetsService = {
  /**
   * One page of the inventory in address order: a block before what it contains, domains last.
   * Raw SQL: the search needs its own LIKE escaping and Prisma cannot order nulls with a tie-break.
   */
  async list(query: TargetListQuery): Promise<TargetListResponse> {
    const where = filterSql(query);
    const [rows, totals] = await Promise.all([
      prisma.$queryRaw<TargetListRow[]>`
        SELECT ${COLUMNS} FROM "Target" t ${where}
        ORDER BY t."rangeStart" ASC NULLS LAST, t."rangeEnd" DESC, t.value ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
      prisma.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM "Target" t ${where}`,
    ]);
    const usage = await usageOf(rows);
    return {
      items: rows.map((row) => toTarget(row, usage.get(row.id))),
      total: totals[0]?.total ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  },

  /** Only the note and the tags: the value is what past scans refer to. */
  async update(id: string, body: UpdateTargetBody): Promise<Target> {
    const { count } = await prisma.target.updateMany({
      where: { id },
      data: {
        ...(body.note !== undefined && { note: encryptText(body.note.trim()) ?? Prisma.DbNull }),
        ...(body.tags !== undefined && { tags: normalizeTags(body.tags) }),
      },
    });
    if (count === 0) throw HttpError.notFound("Target not found");
    return findTarget(id);
  },

  /** Past scans lose only the link to the target; their results and the hosts' edits stay. */
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
    const owner = { createdById: auth.user.id, tags: body.tags };

    return prisma.$transaction(
      async (tx) => {
        let created = 0;
        for (const batch of chunks(entries, INSERT_BATCH)) {
          const result = await tx.target.createMany({
            data: batch.map((entry) => targetRow(entry, owner)),
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
