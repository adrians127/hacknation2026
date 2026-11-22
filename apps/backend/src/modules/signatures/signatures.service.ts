import {
  SignatureCategorySchema,
  SignatureConfidenceSchema,
  SignatureSeveritySchema,
} from "@subsurf/contracts/signatures/detection.schema";
import {
  SIGNATURE_PREVIEW_SAMPLES,
  SIGNATURE_PROBE_PATHS_MAX,
  SIGNATURES_MAX,
  SignatureDefinitionSchema,
  type CreateSignatureBody,
  type Signature,
  type SignatureDefinition,
  type SignatureExportDocument,
  type SignatureExportItem,
  type SignatureExportQuery,
  type SignatureImportQuery,
  type SignatureImportResponse,
  type SignatureListResponse,
  type SignaturePreviewBody,
  type SignaturePreviewResponse,
  type SignaturePreviewSample,
  type UpdateSignatureBody,
} from "@subsurf/contracts/signatures/signatures.schema";
import { ZodError } from "zod";

import { Prisma } from "~backend/generated/prisma/client";
import { decryptText, encryptText } from "~backend/lib/crypto";
import { HttpError } from "~backend/lib/http-error";
import { prisma } from "~backend/lib/prisma";
import { findScan, scanResultsService } from "~backend/modules/scans/scan-results.service";
import { currentSetHash, loadActiveSet } from "~backend/modules/signatures/signature-catalog";
import {
  assertValidPatterns,
  compileSignature,
  evaluateSignature,
  probePathsOf,
} from "~backend/modules/signatures/signature-engine";
import {
  SIGNATURES_LOCK,
  SIGNATURES_TRANSACTION,
  evaluateNewestScan,
  signatureInput,
  staleScans,
} from "~backend/modules/signatures/signatures.evaluate";

type Db = Prisma.TransactionClient;

const INCLUDE = { createdBy: { select: { id: true, displayName: true } } } as const;
type SignatureRow = Prisma.SignatureGetPayload<{ include: typeof INCLUDE }>;
type Hits = NonNullable<Signature["hits"]>;

/** Stands in for a signature that is not saved yet in a preview; never stored. */
const PREVIEW_ID = "00000000-0000-7000-8000-000000000000";
const NO_HITS: Hits = { hosts: 0, services: 0 };

function toSignature(row: SignatureRow, hits: Hits | null): Signature {
  return {
    id: row.id,
    key: row.key,
    builtIn: row.key !== null,
    name: row.name,
    description: decryptText(row.description),
    category: SignatureCategorySchema.parse(row.category),
    product: row.product,
    severity: row.severity === null ? null : SignatureSeveritySchema.parse(row.severity),
    confidence: SignatureConfidenceSchema.parse(row.confidence),
    enabled: row.enabled,
    definition: SignatureDefinitionSchema.parse(row.definition),
    hits,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The newest scan with results and, once it is evaluated with the enabled set, its hits. */
async function newestScanHits(): Promise<{
  scan: { id: string; startedAt: string | null } | null;
  hits: Map<string, Hits> | null;
}> {
  const newest = await prisma.scan.findFirst({
    where: { results: { some: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true, startedAt: true, signatureState: { select: { setHash: true } } },
  });
  if (!newest) return { scan: null, hits: null };
  const scan = { id: newest.id, startedAt: newest.startedAt?.toISOString() ?? null };
  if (newest.signatureState?.setHash !== (await currentSetHash(prisma))) return { scan, hits: null };
  const rows = await prisma.$queryRaw<{ signatureId: string; hosts: number; services: number }[]>`
    SELECT m."signatureId", count(DISTINCT s."hostId")::int AS hosts, count(*)::int AS services
    FROM "SignatureMatch" m
    JOIN "Service" s ON s.id = m."serviceId"
    WHERE m."scanId" = ${newest.id}::uuid
    GROUP BY m."signatureId"`;
  return { scan, hits: new Map(rows.map(({ signatureId, ...hits }) => [signatureId, hits])) };
}

const hitsOf = (row: SignatureRow, hits: Map<string, Hits> | null) =>
  row.enabled && hits !== null ? (hits.get(row.id) ?? NO_HITS) : null;

async function getSignature(id: string): Promise<Signature> {
  const row = await prisma.signature.findUnique({ where: { id }, include: INCLUDE });
  if (!row) throw HttpError.notFound("Signature not found");
  return toSignature(row, hitsOf(row, (await newestScanHits()).hits));
}

/** Signature changes commit one at a time, never in the middle of an evaluation's write. */
function inSignaturesTransaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(${SIGNATURES_LOCK})`;
    return work(db);
  }, SIGNATURES_TRANSACTION);
}

/** Checked after a write in the same transaction: a breach rolls the write back. */
async function assertLimits(db: Db): Promise<void> {
  const custom = await db.signature.count({ where: { key: null } });
  if (custom > SIGNATURES_MAX) {
    throw HttpError.conflict(`At most ${SIGNATURES_MAX} custom signatures`, "SIGNATURE_LIMIT");
  }
  const enabled = await db.signature.findMany({ where: { enabled: true }, select: { definition: true } });
  const paths = new Set(
    enabled.flatMap((row) => probePathsOf(SignatureDefinitionSchema.parse(row.definition))),
  );
  if (paths.size > SIGNATURE_PROBE_PATHS_MAX) {
    throw HttpError.conflict(
      `The enabled signatures may request at most ${SIGNATURE_PROBE_PATHS_MAX} probe paths`,
      "SIGNATURE_PROBE_LIMIT",
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const nameTaken = () => HttpError.conflict("A signature with this name exists", "SIGNATURE_NAME_TAKEN");

/** The stored matches stop depending on a signature that is now off or gone. */
async function dropMatches(db: Db, signatureId: string, before: string): Promise<void> {
  await db.signatureMatch.deleteMany({ where: { signatureId } });
  const after = await currentSetHash(db);
  // Scans that were current stay current: no other signature's matches changed.
  await db.signatureScanState.updateMany({ where: { setHash: before }, data: { setHash: after } });
}

const descriptionValue = (description: string) => encryptText(description.trim()) ?? Prisma.DbNull;

function fieldsOf(body: CreateSignatureBody | SignatureExportItem) {
  return {
    name: body.name.trim(),
    description: descriptionValue(body.description ?? ""),
    category: body.category,
    product: body.product?.trim() ?? null,
    severity: body.severity ?? null,
    confidence: body.confidence,
    enabled: body.enabled ?? true,
    definition: body.definition,
  };
}

function patternsOf(definitions: readonly SignatureDefinition[]): void {
  const issues = definitions.flatMap((definition, index) => {
    try {
      assertValidPatterns(definition);
      return [];
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      return error.issues.map((issue) => ({
        ...issue,
        path: ["signatures", index, ...issue.path],
        message: `Signature ${index + 1}, ${issue.message}`,
      }));
    }
  });
  if (issues.length > 0) throw new ZodError(issues);
}

function exportItem(row: SignatureRow): SignatureExportItem {
  const signature = toSignature(row, null);
  return {
    ...(signature.key !== null && { key: signature.key }),
    name: signature.name,
    ...(signature.description !== "" && { description: signature.description }),
    category: signature.category,
    product: signature.product,
    severity: signature.severity,
    confidence: signature.confidence,
    enabled: signature.enabled,
    definition: signature.definition,
  };
}

export const signaturesService = {
  async list(): Promise<SignatureListResponse> {
    const [rows, { scan, hits }, set] = await Promise.all([
      prisma.signature.findMany({
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: INCLUDE,
      }),
      newestScanHits(),
      loadActiveSet(),
    ]);
    return {
      items: rows.map((row) => toSignature(row, hitsOf(row, hits))),
      probePaths: set.probePaths,
      evaluation: { scan, pendingScans: (await staleScans(set.hash)).length },
    };
  },

  get: getSignature,

  async create(createdById: string, body: CreateSignatureBody): Promise<Signature> {
    assertValidPatterns(body.definition);
    const id = await inSignaturesTransaction(async (db) => {
      const row = await db.signature.create({ data: { ...fieldsOf(body), createdById } });
      await assertLimits(db);
      return row.id;
    }).catch((error: unknown) => {
      throw isUniqueViolation(error) ? nameTaken() : error;
    });
    await evaluateNewestScan();
    return getSignature(id);
  },

  async update(id: string, body: UpdateSignatureBody): Promise<Signature> {
    if (body.definition) assertValidPatterns(body.definition);
    const changed = await inSignaturesTransaction(async (db) => {
      const row = await db.signature.findUnique({ where: { id } });
      if (!row) throw HttpError.notFound("Signature not found");
      const fields = Object.entries(body).filter(([, value]) => value !== undefined);
      if (row.key !== null && fields.some(([field]) => field !== "enabled")) {
        throw HttpError.conflict(
          "A built-in signature can only be switched on or off; duplicate it to change it",
          "SIGNATURE_BUILT_IN",
        );
      }
      const before = await currentSetHash(db);
      await db.signature.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.description !== undefined && { description: descriptionValue(body.description) }),
          ...(body.category !== undefined && { category: body.category }),
          ...(body.product !== undefined && { product: body.product?.trim() ?? null }),
          ...(body.severity !== undefined && { severity: body.severity }),
          ...(body.confidence !== undefined && { confidence: body.confidence }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
          ...(body.definition !== undefined && { definition: body.definition }),
        },
      });
      await assertLimits(db);
      if (row.enabled && body.enabled === false) {
        await dropMatches(db, id, before);
        return false;
      }
      return (await currentSetHash(db)) !== before;
    }).catch((error: unknown) => {
      throw isUniqueViolation(error) ? nameTaken() : error;
    });
    if (changed) await evaluateNewestScan();
    return getSignature(id);
  },

  async remove(id: string): Promise<void> {
    await inSignaturesTransaction(async (db) => {
      const row = await db.signature.findUnique({ where: { id } });
      if (!row) throw HttpError.notFound("Signature not found");
      if (row.key !== null) {
        throw HttpError.conflict(
          "A built-in signature cannot be deleted, only switched off",
          "SIGNATURE_BUILT_IN",
        );
      }
      const before = await currentSetHash(db);
      await db.signature.delete({ where: { id } });
      if (row.enabled) await dropMatches(db, id, before);
    });
  },

  async preview(body: SignaturePreviewBody): Promise<SignaturePreviewResponse> {
    assertValidPatterns(body.definition);
    const scan = body.scanId
      ? await findScan(body.scanId)
      : await prisma.scan.findFirst({ where: { results: { some: {} } }, orderBy: { createdAt: "desc" } });
    if (!scan) return { scan: null, services: 0, hosts: 0, samples: [], unprobedPaths: [] };

    const signature = compileSignature(
      {
        id: PREVIEW_ID,
        key: null,
        name: "preview",
        category: "other",
        product: null,
        severity: null,
        confidence: body.confidence ?? "low",
      },
      body.definition,
    );
    const hosts = new Set<string>();
    const probed = new Set<string>();
    const samples: SignaturePreviewSample[] = [];
    let services = 0;
    for await (const batch of scanResultsService.upObservationBatches(scan.id)) {
      for (const observation of batch) {
        for (const port of observation.ports) {
          const input = signatureInput(port);
          for (const endpoint of input.http) for (const probe of endpoint.probes) probed.add(probe.path);
          const detection = evaluateSignature(signature, input);
          if (detection === null) continue;
          services += 1;
          if (observation.hostId !== null) hosts.add(observation.hostId);
          if (samples.length < SIGNATURE_PREVIEW_SAMPLES && observation.hostId !== null) {
            samples.push({
              hostId: observation.hostId,
              serviceId: port.serviceId,
              ip: observation.ip,
              port: port.port,
              confidence: detection.confidence,
              version: detection.version,
              evidence: detection.evidence,
            });
          }
        }
      }
    }
    return {
      scan: { id: scan.id, startedAt: scan.startedAt?.toISOString() ?? null },
      services,
      hosts: hosts.size,
      samples,
      unprobedPaths: signature.probePaths.filter((path) => !probed.has(path)),
    };
  },

  async export(query: SignatureExportQuery): Promise<SignatureExportDocument> {
    const rows = await prisma.signature.findMany({
      where: query.builtIn === "true" ? {} : { key: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: INCLUDE,
    });
    return {
      format: "subsurf.signatures",
      version: 1,
      exportedAt: new Date().toISOString(),
      signatures: rows.map(exportItem),
    };
  },

  async import(
    createdById: string,
    document: SignatureExportDocument,
    query: SignatureImportQuery,
  ): Promise<SignatureImportResponse> {
    patternsOf(document.signatures.map((item) => item.definition));
    const counts: SignatureImportResponse = { created: 0, replaced: 0, skipped: 0, builtIn: 0 };
    const changed = await inSignaturesTransaction(async (db) => {
      const before = await currentSetHash(db);
      for (const item of document.signatures) {
        const builtIn = item.key ? await db.signature.findUnique({ where: { key: item.key } }) : null;
        if (builtIn) {
          if (item.enabled !== undefined && item.enabled !== builtIn.enabled) {
            await db.signature.update({ where: { id: builtIn.id }, data: { enabled: item.enabled } });
          }
          counts.builtIn += 1;
          continue;
        }
        const existing = await db.signature.findUnique({ where: { name: item.name.trim() } });
        if (!existing) {
          await db.signature.create({ data: { ...fieldsOf(item), createdById } });
          counts.created += 1;
        } else if (existing.key === null && query.conflict === "replace") {
          await db.signature.update({ where: { id: existing.id }, data: fieldsOf(item) });
          counts.replaced += 1;
        } else {
          counts.skipped += 1;
        }
      }
      await assertLimits(db);
      return (await currentSetHash(db)) !== before;
    });
    if (changed) await evaluateNewestScan();
    return counts;
  },
};
