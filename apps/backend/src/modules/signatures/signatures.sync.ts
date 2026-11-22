import { Prisma } from "~backend/generated/prisma/client";
import { decryptText, encryptText } from "~backend/lib/crypto";
import { prisma } from "~backend/lib/prisma";
import { sameJson } from "~backend/lib/same-json";
import { BUILT_IN_SIGNATURES } from "~backend/modules/signatures/builtin-signatures";

/**
 * Makes the built-in signatures in the database match `builtin-signatures.ts`: by `key`, keeping
 * whether users switched each one off, and dropping built-ins the code no longer has. Idempotent;
 * runs at startup, in the seed and before tests. A custom signature that took a new built-in's name
 * is renamed so the built-in can have it.
 */
export async function syncBuiltInSignatures(): Promise<void> {
  const existing = new Map(
    (await prisma.signature.findMany({ where: { key: { not: null } } })).map((row) => [row.key, row]),
  );
  // An empty table (first start, every test): one insert.
  if (existing.size === 0 && (await prisma.signature.count()) === 0) {
    await prisma.signature.createMany({
      data: BUILT_IN_SIGNATURES.map(({ description, ...fields }) => ({
        ...fields,
        description: encryptText(description) ?? Prisma.DbNull,
      })),
    });
    return;
  }
  for (const builtIn of BUILT_IN_SIGNATURES) {
    const { key, description, ...fields } = builtIn;
    const row = existing.get(key);
    if (
      row &&
      row.name === fields.name &&
      row.category === fields.category &&
      row.product === fields.product &&
      row.severity === fields.severity &&
      row.confidence === fields.confidence &&
      sameJson(row.definition, fields.definition) &&
      decryptText(row.description) === description
    ) {
      continue;
    }
    const taken = await prisma.signature.findFirst({
      where: { name: fields.name, OR: [{ key: null }, { key: { not: key } }] },
    });
    if (taken) {
      await prisma.signature.update({
        where: { id: taken.id },
        data: { name: `${taken.name} (custom ${taken.id.slice(0, 8)})` },
      });
    }
    const data = { ...fields, description: encryptText(description) ?? Prisma.DbNull };
    await prisma.signature.upsert({ where: { key }, create: { key, ...data }, update: data });
  }
  const keys = BUILT_IN_SIGNATURES.map((builtIn) => builtIn.key);
  await prisma.signature.deleteMany({ where: { key: { not: null, notIn: keys } } });
}
