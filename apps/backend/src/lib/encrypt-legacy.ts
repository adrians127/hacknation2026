import { encryptJson, encryptText } from "~backend/lib/crypto";
import { prisma } from "~backend/lib/prisma";

const BATCH = 1000;

async function encryptTargetNotes(): Promise<number> {
  let encrypted = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<{ id: string; note: string }[]>`
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

async function encryptScanWarnings(): Promise<number> {
  let encrypted = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<{ id: string; warnings: unknown }[]>`
      SELECT id, warnings FROM "Scan"
      WHERE jsonb_typeof(warnings) = 'array' LIMIT ${BATCH}`;
    if (rows.length === 0) return encrypted;
    const sealed = rows.map((row) => ({ id: row.id, warnings: encryptJson(row.warnings) }));
    encrypted += await prisma.$executeRaw`
      UPDATE "Scan" s SET warnings = v.warnings
      FROM jsonb_to_recordset(${JSON.stringify(sealed)}::jsonb) AS v(id uuid, warnings jsonb)
      WHERE s.id = v.id AND jsonb_typeof(s.warnings) = 'array'`;
  }
}

/**
 * Encrypts values a migration left plain in a column that is now encrypted (target notes as
 * JSON strings, scan warnings as arrays): SQL cannot do it, because the key never reaches the
 * database. Idempotent, and safe to run from several processes: an update only touches a row
 * that is still plain. Returns how many it wrote.
 */
export async function encryptLegacyRows(): Promise<number> {
  return (await encryptTargetNotes()) + (await encryptScanWarnings());
}
