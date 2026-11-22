import type { ParsedTarget } from "@subsurf/contracts/targets/target-input";

import { Prisma } from "~backend/generated/prisma/client";
import { encryptText } from "~backend/lib/crypto";

/** A parsed entry as a `Target` row: the note encrypted, the covered addresses as integers. */
export function targetRow(
  entry: Pick<ParsedTarget, "kind" | "value" | "note" | "range">,
  owner: { createdById: string; tags?: readonly string[] },
): Prisma.TargetCreateManyInput {
  return {
    kind: entry.kind,
    value: entry.value,
    note: encryptText(entry.note.trim()) ?? Prisma.DbNull,
    tags: [...(owner.tags ?? [])],
    rangeStart: entry.range === null ? null : BigInt(entry.range.start),
    rangeEnd: entry.range === null ? null : BigInt(entry.range.end),
    createdById: owner.createdById,
  };
}
