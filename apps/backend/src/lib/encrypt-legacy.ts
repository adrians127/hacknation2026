import { encryptText } from "~backend/lib/crypto";
import { prisma } from "~backend/lib/prisma";

const BATCH = 1000;

interface LegacyRow {
  id: string;
  note: string;
}

/**
 * Encrypts notes a migration moved from a text column into JSON as plain strings: SQL cannot
 * do it, because the key never reaches the database. Idempotent, and safe to run from several
 * processes: an update only touches a row that still holds a string. Returns how many it wrote.
 */
export async function encryptLegacyRows(): Promise<number> {
  let encrypted = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<LegacyRow[]>`
      SELECT id, note #>> '{}' AS note FROM "Target"
      WHERE jsonb_typeof(note) = 'string' LIMIT ${BATCH}`;
    if (rows.length === 0) return encrypted;
    const sealed = rows.map((row) => ({ id: row.id, note: encryptText(row.note) }));
    encrypted += await prisma.$executeRaw`
      UPDATE "Target" t SET note = v.note
      FROM jsonb_to_recordset(${JSON.stringify(sealed)}::jsonb) AS v(id uuid, note jsonb)
      WHERE t.id = v.id AND jsonb_typeof(t.note) = 'string'`;
  }
}
