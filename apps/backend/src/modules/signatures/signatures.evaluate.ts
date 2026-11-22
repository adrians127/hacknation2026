import { Prisma } from "~backend/generated/prisma/client";
import { encryptJson } from "~backend/lib/crypto";
import { prisma } from "~backend/lib/prisma";
import { openPortDetails } from "~backend/modules/results/details";
import { scanResultsService } from "~backend/modules/scans/scan-results.service";
import type { ObservationRow } from "~backend/modules/scans/scan-results.mapper";
import {
  currentSetHash,
  loadActiveSet,
  type ActiveSet,
} from "~backend/modules/signatures/signature-catalog";
import { evaluateService, type SignatureInput } from "~backend/modules/signatures/signature-engine";

/** Signature changes and the writes of an evaluation take it, so a write never mixes two sets. */
export const SIGNATURES_LOCK = 7_366_737_303;
export const SIGNATURES_TRANSACTION = { timeout: 2 * 60_000, maxWait: 30_000 };
const INSERT_CHUNK = 5000;

type PortRow = ObservationRow["ports"][number];

/** What the engine reads of one merged port: nmap's own fields, not users' corrections. */
export function signatureInput(port: PortRow): SignatureInput {
  const details = openPortDetails(port.details);
  return {
    port: port.port,
    service: {
      name: port.serviceName,
      product: port.serviceProduct,
      version: port.serviceVersion,
      extraInfo: port.serviceExtraInfo,
      cpe: port.serviceCpe,
    },
    banner: details.banner,
    http: details.http,
  };
}

export interface ScanEvaluation {
  scanId: string;
  services: number;
  matches: number;
  /** `written`; `outdated`: the signatures changed meanwhile; `current`: nothing to do; `gone`: scan deleted. */
  outcome: "written" | "outdated" | "current" | "gone";
}

const running = new Map<string, Promise<ScanEvaluation>>();

async function evaluate(scanId: string, set: ActiveSet): Promise<ScanEvaluation> {
  const resultCount = await prisma.scanJobResult.count({ where: { scanId } });
  const rows: Prisma.SignatureMatchCreateManyInput[] = [];
  let services = 0;
  for await (const batch of scanResultsService.upObservationBatches(scanId)) {
    for (const observation of batch) {
      for (const port of observation.ports) {
        services += 1;
        for (const detection of evaluateService(set.signatures, signatureInput(port))) {
          rows.push({
            scanId,
            serviceId: port.serviceId,
            signatureId: detection.signature.id,
            confidence: detection.confidence,
            version: detection.version,
            sources: detection.sources,
            evidence: encryptJson(detection.evidence),
          });
        }
      }
    }
  }

  try {
    return await prisma.$transaction(async (db) => {
      await db.$executeRaw`SELECT pg_advisory_xact_lock(${SIGNATURES_LOCK})`;
      if ((await currentSetHash(db)) !== set.hash) {
        return { scanId, services, matches: rows.length, outcome: "outdated" } as const;
      }
      const state = await db.signatureScanState.findUnique({ where: { scanId } });
      if (state && state.setHash === set.hash && state.resultCount >= resultCount) {
        return { scanId, services, matches: rows.length, outcome: "current" } as const;
      }
      await db.signatureMatch.deleteMany({ where: { scanId } });
      for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
        await db.signatureMatch.createMany({ data: rows.slice(start, start + INSERT_CHUNK) });
      }
      const values = {
        setHash: set.hash,
        resultCount,
        services,
        matches: rows.length,
        evaluatedAt: new Date(),
      };
      await db.signatureScanState.upsert({
        where: { scanId },
        create: { scanId, ...values },
        update: values,
      });
      return { scanId, services, matches: rows.length, outcome: "written" } as const;
    }, SIGNATURES_TRANSACTION);
  } catch (error) {
    // The scan was deleted while it was evaluated.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return { scanId, services, matches: 0, outcome: "gone" };
    }
    throw error;
  }
}

/**
 * Evaluates the enabled signatures on the scan's merged observations and replaces its matches.
 * Two calls for one scan share the work.
 */
export async function evaluateScan(scanId: string, set?: ActiveSet): Promise<ScanEvaluation> {
  const pending = running.get(scanId);
  if (pending) return pending;
  const work = (async () => evaluate(scanId, set ?? (await loadActiveSet())))();
  running.set(scanId, work);
  try {
    return await work;
  } finally {
    running.delete(scanId);
  }
}

export interface StaleScan {
  id: string;
  status: string;
  evaluatedAt: Date | null;
  setHash: string | null;
}

/** Scans with results whose matches are missing or behind (set changed, more results), newest first. */
export function staleScans(hash: string): Promise<StaleScan[]> {
  return prisma.$queryRaw<StaleScan[]>`
    SELECT s.id, s.status::text AS status, st."evaluatedAt", st."setHash"
    FROM "Scan" s
    JOIN (SELECT "scanId", count(*)::int AS results FROM "ScanJobResult" GROUP BY "scanId") r
      ON r."scanId" = s.id
    LEFT JOIN "SignatureScanState" st ON st."scanId" = s.id
    WHERE st."scanId" IS NULL OR st."setHash" <> ${hash} OR st."resultCount" <> r.results
    ORDER BY s."createdAt" DESC`;
}

/** Evaluates the newest scan with results, if any: what a signature change shows at once. */
export async function evaluateNewestScan(): Promise<void> {
  const newest = await scanResultsService.latestWithResults();
  if (newest) await evaluateScan(newest.id);
}

/** Every scan that is behind, newest first (the seed, and `pnpm` scripts). */
export async function evaluateStaleScans(): Promise<ScanEvaluation[]> {
  const set = await loadActiveSet();
  const evaluations: ScanEvaluation[] = [];
  for (const scan of await staleScans(set.hash)) evaluations.push(await evaluateScan(scan.id, set));
  return evaluations;
}
