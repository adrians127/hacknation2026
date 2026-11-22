import { prisma } from "~backend/lib/prisma";
import type { NormalizedVulnerability } from "~backend/modules/vulnerabilities/sources/source";

export const BATCH_SIZE = 1000;

export interface BatchStats {
  /** Inserted, or changed since the stored copy (`sourceModifiedAt` or status). */
  upserted: number;
  unchanged: number;
  /** Of the upserted: now rejected or withdrawn. */
  withdrawn: number;
}

const TRANSACTION_TIMEOUT_MS = 120_000;

// ISO strings read as `timestamp` (no zone): the UTC wall clock Prisma stores DateTime as.
function toRow(record: NormalizedVulnerability) {
  return {
    externalId: record.externalId,
    canonicalId: record.canonicalId,
    aliases: record.aliases,
    scopes: record.scopes,
    title: record.title,
    description: record.description,
    status: record.status,
    withdrawnAt: record.withdrawnAt?.toISOString() ?? null,
    withdrawReason: record.status === "active" ? null : record.status,
    severity: record.severity,
    cvssScore: record.cvssScore,
    cvssVector: record.cvssVector,
    cvssVersion: record.cvssVersion,
    kevAddedAt: record.kevAddedAt?.toISOString() ?? null,
    kevDueDate: record.kevDueDate?.toISOString() ?? null,
    references: record.references,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    sourceModifiedAt: record.sourceModifiedAt?.toISOString() ?? null,
  };
}

/** One record per external id; a later copy wins, scopes merge (OSV lists a GHSA per ecosystem). */
function dedupe(records: readonly NormalizedVulnerability[]): NormalizedVulnerability[] {
  const byId = new Map<string, NormalizedVulnerability>();
  for (const record of records) {
    const earlier = byId.get(record.externalId);
    byId.set(
      record.externalId,
      earlier ? { ...record, scopes: [...new Set([...earlier.scopes, ...record.scopes])] } : record,
    );
  }
  return [...byId.values()];
}

/**
 * Writes one batch in one transaction. Records whose `sourceModifiedAt` and status did not change
 * only get `lastSeenAt` (and new scopes), so a weekly full sync rewrites little; changed ones get
 * their criteria replaced.
 */
export async function writeBatch(
  sourceId: string,
  batch: readonly NormalizedVulnerability[],
  seenAt: Date,
): Promise<BatchStats> {
  const records = dedupe(batch);
  if (records.length === 0) return { upserted: 0, unchanged: 0, withdrawn: 0 };
  const rows = JSON.stringify(records.map(toRow));

  return prisma.$transaction(
    async (tx) => {
      const changed = await tx.$queryRaw<{ id: string; externalId: string }[]>`
        INSERT INTO "Vulnerability" AS v (
          "id", "sourceId", "externalId", "canonicalId", "aliases", "scopes", "title",
          "description", "status", "withdrawnAt", "withdrawReason", "severity", "cvssScore",
          "cvssVector", "cvssVersion", "kevAddedAt", "kevDueDate", "references", "publishedAt",
          "sourceModifiedAt", "lastSeenAt", "updatedAt"
        )
        SELECT uuidv7(), ${sourceId}, r."externalId", r."canonicalId", r."aliases", r."scopes",
          r."title", r."description", r."status"::"VulnerabilityStatus", r."withdrawnAt",
          r."withdrawReason", r."severity"::"VulnerabilitySeverity", r."cvssScore",
          r."cvssVector", r."cvssVersion", r."kevAddedAt", r."kevDueDate", r."references",
          r."publishedAt", r."sourceModifiedAt", ${seenAt}, ${seenAt}
        FROM jsonb_to_recordset(${rows}::jsonb) AS r(
          "externalId" text, "canonicalId" text, "aliases" text[], "scopes" text[], "title" text,
          "description" text, "status" text, "withdrawnAt" timestamp, "withdrawReason" text,
          "severity" text, "cvssScore" double precision, "cvssVector" text, "cvssVersion" text,
          "kevAddedAt" timestamp, "kevDueDate" timestamp, "references" text[],
          "publishedAt" timestamp, "sourceModifiedAt" timestamp
        )
        ON CONFLICT ("sourceId", "externalId") DO UPDATE SET
          "canonicalId" = EXCLUDED."canonicalId",
          "aliases" = EXCLUDED."aliases",
          "scopes" = ARRAY(SELECT DISTINCT unnest(v."scopes" || EXCLUDED."scopes")),
          "title" = EXCLUDED."title",
          "description" = EXCLUDED."description",
          "status" = EXCLUDED."status",
          "withdrawnAt" = EXCLUDED."withdrawnAt",
          "withdrawReason" = EXCLUDED."withdrawReason",
          "severity" = EXCLUDED."severity",
          "cvssScore" = EXCLUDED."cvssScore",
          "cvssVector" = EXCLUDED."cvssVector",
          "cvssVersion" = EXCLUDED."cvssVersion",
          "kevAddedAt" = EXCLUDED."kevAddedAt",
          "kevDueDate" = EXCLUDED."kevDueDate",
          "references" = EXCLUDED."references",
          "publishedAt" = EXCLUDED."publishedAt",
          "sourceModifiedAt" = EXCLUDED."sourceModifiedAt",
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "updatedAt" = EXCLUDED."updatedAt"
        WHERE v."sourceModifiedAt" IS DISTINCT FROM EXCLUDED."sourceModifiedAt"
          OR v."status" IS DISTINCT FROM EXCLUDED."status"
        RETURNING v."id", v."externalId"`;

      const changedIds = new Set(changed.map((row) => row.externalId));
      const idByExternal = new Map(changed.map((row) => [row.externalId, row.id]));
      const changedRecords = records.filter((record) => changedIds.has(record.externalId));
      const unchanged = records.filter((record) => !changedIds.has(record.externalId));

      if (changedRecords.length > 0) {
        const ids = changedRecords.map((record) => idByExternal.get(record.externalId) ?? "");
        await tx.$executeRaw`
          DELETE FROM "VulnerabilityCriterion" WHERE "vulnerabilityId" = ANY(${ids}::uuid[])`;
        const criteria = changedRecords.flatMap((record) =>
          record.criteria.map((criterion) => ({
            vulnerabilityId: idByExternal.get(record.externalId),
            kind: criterion.kind,
            matchKey: criterion.matchKey,
            data: criterion.data,
          })),
        );
        if (criteria.length > 0) {
          await tx.$executeRaw`
            INSERT INTO "VulnerabilityCriterion" ("vulnerabilityId", "kind", "matchKey", "data")
            SELECT c."vulnerabilityId", c."kind", c."matchKey", c."data"
            FROM jsonb_to_recordset(${JSON.stringify(criteria)}::jsonb) AS c(
              "vulnerabilityId" uuid, "kind" text, "matchKey" text, "data" jsonb
            )`;
        }
      }

      if (unchanged.length > 0) {
        const seen = JSON.stringify(
          unchanged.map((record) => ({ externalId: record.externalId, scopes: record.scopes })),
        );
        await tx.$executeRaw`
          UPDATE "Vulnerability" AS v
          SET "lastSeenAt" = ${seenAt},
              "scopes" = ARRAY(SELECT DISTINCT unnest(v."scopes" || s."scopes"))
          FROM jsonb_to_recordset(${seen}::jsonb) AS s("externalId" text, "scopes" text[])
          WHERE v."sourceId" = ${sourceId} AND v."externalId" = s."externalId"`;
      }

      return {
        upserted: changedRecords.length,
        unchanged: unchanged.length,
        withdrawn: changedRecords.filter((record) => record.status !== "active").length,
      };
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );
}

/** Writes any number of records in batches (offline import, demo data): no cursor, no sweep. */
export async function writeRecords(
  sourceId: string,
  records: AsyncIterable<NormalizedVulnerability> | Iterable<NormalizedVulnerability>,
  seenAt: Date,
): Promise<BatchStats> {
  const total: BatchStats = { upserted: 0, unchanged: 0, withdrawn: 0 };
  let batch: NormalizedVulnerability[] = [];
  const flush = async () => {
    const stats = await writeBatch(sourceId, batch, seenAt);
    total.upserted += stats.upserted;
    total.unchanged += stats.unchanged;
    total.withdrawn += stats.withdrawn;
    batch = [];
  };
  for await (const record of records) {
    batch.push(record);
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return total;
}
