import { createHash } from "node:crypto";

import {
  SignatureCategorySchema,
  SignatureConfidenceSchema,
  SignatureSeveritySchema,
  type SignatureSeverity,
} from "@subsurf/contracts/signatures/detection.schema";
import { SignatureDefinitionSchema } from "@subsurf/contracts/signatures/signatures.schema";

import type { Prisma } from "~backend/generated/prisma/client";
import { logger } from "~backend/lib/logger";
import { prisma } from "~backend/lib/prisma";
import {
  ENGINE_VERSION,
  compileSignature,
  type CompiledSignature,
  type SignatureMeta,
} from "~backend/modules/signatures/signature-engine";

type Db = Prisma.TransactionClient | typeof prisma;

/** Always requested: the plain-HTTP login check of the findings report reads it. */
const FIXED_PROBE_PATHS = ["/login"];

const SEVERITY_RANK: Record<SignatureSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };

const SET_SELECT = {
  id: true,
  key: true,
  name: true,
  category: true,
  product: true,
  severity: true,
  confidence: true,
  definition: true,
} as const satisfies Prisma.SignatureSelect;

type SetRow = Prisma.SignatureGetPayload<{ select: typeof SET_SELECT }>;

/** The enabled signatures, compiled. */
export interface ActiveSet {
  /** What a scan's matches depend on (`SignatureScanState.setHash`): ids, definitions, confidence. */
  hash: string;
  signatures: CompiledSignature[];
  /** Probe paths the set needs, highest severity first, then `/login`. */
  probePaths: string[];
}

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function setHashOf(rows: readonly Pick<SetRow, "id" | "definition" | "confidence">[]): string {
  const parts = rows
    .map((row) => ({ id: row.id, definition: row.definition, confidence: row.confidence }))
    .toSorted((a, b) => a.id.localeCompare(b.id));
  return sha256([ENGINE_VERSION, parts]);
}

function loadRows(db: Db): Promise<SetRow[]> {
  return db.signature.findMany({
    where: { enabled: true },
    // Oldest first: the built-ins in their list order (synced first), then custom ones.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: SET_SELECT,
  });
}

/** The `setHash` of the signatures enabled now, as `db` sees them (inside a transaction too). */
export async function currentSetHash(db: Db = prisma): Promise<string> {
  const rows = await db.signature.findMany({
    where: { enabled: true },
    select: { id: true, definition: true, confidence: true },
  });
  return setHashOf(rows);
}

function toMeta(row: SetRow): SignatureMeta {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    category: SignatureCategorySchema.parse(row.category),
    product: row.product,
    severity: row.severity === null ? null : SignatureSeveritySchema.parse(row.severity),
    confidence: SignatureConfidenceSchema.parse(row.confidence),
  };
}

function compileRows(rows: readonly SetRow[]): CompiledSignature[] {
  return rows.flatMap((row) => {
    try {
      return [compileSignature(toMeta(row), SignatureDefinitionSchema.parse(row.definition))];
    } catch (error) {
      // Saved definitions were checked; this only happens when the rules got stricter.
      logger.warn({ err: error, signatureId: row.id }, "Skipping a signature that no longer compiles");
      return [];
    }
  });
}

export function probePathsOf(signatures: readonly CompiledSignature[]): string[] {
  const ordered = signatures.toSorted(
    (a, b) =>
      (a.meta.severity === null ? 4 : SEVERITY_RANK[a.meta.severity]) -
      (b.meta.severity === null ? 4 : SEVERITY_RANK[b.meta.severity]),
  );
  return [...new Set([...ordered.flatMap((signature) => signature.probePaths), ...FIXED_PROBE_PATHS])];
}

let cached: { key: string; set: ActiveSet } | null = null;

/** The enabled signatures, compiled once per change (names and ratings included). */
export async function loadActiveSet(db: Db = prisma): Promise<ActiveSet> {
  const rows = await loadRows(db);
  const key = sha256(rows);
  if (cached?.key === key) return cached.set;
  const signatures = compileRows(rows);
  const set = { hash: setHashOf(rows), signatures, probePaths: probePathsOf(signatures) };
  cached = { key, set };
  return set;
}
