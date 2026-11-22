import {
  SignatureCategorySchema,
  SignatureConfidenceSchema,
  SignatureEvidenceSchema,
  SignatureSeveritySchema,
  SignatureTargetSchema,
  type Detection,
  type DetectionSummary,
  type SignatureSeverity,
} from "@subsurf/contracts/signatures/detection.schema";
import type { ScanDetectionsResponse } from "@subsurf/contracts/scans/scan-results.schema";
import { z } from "zod";

import { Prisma } from "~backend/generated/prisma/client";
import { decryptJson, isEncryptedValue } from "~backend/lib/crypto";
import { prisma } from "~backend/lib/prisma";
import { currentSetHash } from "~backend/modules/signatures/signature-catalog";

const SEVERITY_RANK: Record<SignatureSeverity, number> = { high: 4, medium: 3, low: 2, info: 1 };
const rank = (severity: SignatureSeverity | null) => (severity === null ? 0 : SEVERITY_RANK[severity]);

/** Most severe first, then by name. */
export function bySeverity(a: Pick<DetectionSummary, "severity" | "name">, b: Pick<DetectionSummary, "severity" | "name">) {
  return rank(b.severity) - rank(a.severity) || a.name.localeCompare(b.name);
}

const SIGNATURE_SELECT = {
  id: true,
  key: true,
  name: true,
  category: true,
  product: true,
  severity: true,
} as const satisfies Prisma.SignatureSelect;

type SignatureRow = Prisma.SignatureGetPayload<{ select: typeof SIGNATURE_SELECT }>;

function summaryOf(
  signature: SignatureRow,
  match: { confidence: string; version: string | null },
): DetectionSummary {
  return {
    signatureId: signature.id,
    key: signature.key,
    name: signature.name,
    category: SignatureCategorySchema.parse(signature.category),
    product: signature.product,
    severity: signature.severity === null ? null : SignatureSeveritySchema.parse(signature.severity),
    confidence: SignatureConfidenceSchema.parse(match.confidence),
    version: match.version,
    builtIn: signature.key !== null,
  };
}

function group<T>(rows: readonly { serviceId: string; value: T }[]): Map<string, T[]> {
  const byService = new Map<string, T[]>();
  for (const { serviceId, value } of rows) byService.set(serviceId, [...(byService.get(serviceId) ?? []), value]);
  return byService;
}

/** Distinct signatures across services, most severe first (a host's detections). */
export function distinctDetections(detections: readonly DetectionSummary[]): DetectionSummary[] {
  const bySignature = new Map<string, DetectionSummary>();
  for (const detection of detections) {
    const known = bySignature.get(detection.signatureId);
    if (!known || (known.version === null && detection.version !== null)) bySignature.set(detection.signatureId, detection);
  }
  return [...bySignature.values()].toSorted(bySeverity);
}

/** Stored matches of scans (`SignatureMatch`), for the scan views, diffs and exports. */
export const signatureMatchesService = {
  /** Per service, without evidence (nothing to decrypt). */
  async summaries(scanId: string, serviceIds: readonly string[]): Promise<Map<string, DetectionSummary[]>> {
    if (serviceIds.length === 0) return new Map();
    const rows = await prisma.signatureMatch.findMany({
      where: { scanId, serviceId: { in: [...serviceIds] }, signature: { enabled: true } },
      select: { serviceId: true, confidence: true, version: true, signature: { select: SIGNATURE_SELECT } },
    });
    const byService = group(rows.map((row) => ({ serviceId: row.serviceId, value: summaryOf(row.signature, row) })));
    for (const list of byService.values()) list.sort(bySeverity);
    return byService;
  },

  /** Per service, with the evidence decrypted (host detail). */
  async details(scanId: string, serviceIds: readonly string[]): Promise<Map<string, Detection[]>> {
    if (serviceIds.length === 0) return new Map();
    const rows = await prisma.signatureMatch.findMany({
      where: { scanId, serviceId: { in: [...serviceIds] }, signature: { enabled: true } },
      select: {
        serviceId: true,
        confidence: true,
        version: true,
        sources: true,
        evidence: true,
        signature: { select: SIGNATURE_SELECT },
      },
    });
    const byService = group(
      rows.map((row) => ({
        serviceId: row.serviceId,
        value: {
          ...summaryOf(row.signature, row),
          sources: z.array(SignatureTargetSchema).parse(row.sources),
          evidence: z
            .array(SignatureEvidenceSchema)
            .parse(isEncryptedValue(row.evidence) ? decryptJson(row.evidence) : []),
        },
      })),
    );
    for (const list of byService.values()) list.sort(bySeverity);
    return byService;
  },

  /** Hosts a signature matched in the scan; `any`: any signature with a severity. */
  async hostIdsWith(scanId: string, signature: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ hostId: string }[]>`
      SELECT DISTINCT s."hostId"
      FROM "SignatureMatch" m
      JOIN "Service" s ON s.id = m."serviceId"
      JOIN "Signature" g ON g.id = m."signatureId"
      WHERE m."scanId" = ${scanId}::uuid AND g.enabled
        AND ${signature === "any" ? Prisma.sql`g.severity IS NOT NULL` : Prisma.sql`g.id = ${signature}::uuid`}`;
    return rows.map((row) => row.hostId);
  },

  /** Hosts of the scan per the most severe signature that matched them (signatures with a severity). */
  async hostsBySeverity(scanId: string): Promise<Record<SignatureSeverity, number>> {
    const rows = await prisma.$queryRaw<{ severity: SignatureSeverity; hosts: number }[]>`
      WITH ranked AS (
        SELECT s."hostId", max(CASE g.severity WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END) AS rank
        FROM "SignatureMatch" m
        JOIN "Service" s ON s.id = m."serviceId"
        JOIN "Signature" g ON g.id = m."signatureId"
        WHERE m."scanId" = ${scanId}::uuid AND g.enabled AND g.severity IS NOT NULL
        GROUP BY s."hostId"
      )
      SELECT CASE rank WHEN 4 THEN 'high' WHEN 3 THEN 'medium' WHEN 2 THEN 'low' ELSE 'info' END AS severity,
        count(*)::int AS hosts
      FROM ranked GROUP BY 1`;
    const counts: Record<SignatureSeverity, number> = { high: 0, medium: 0, low: 0, info: 0 };
    for (const row of rows) counts[row.severity] = row.hosts;
    return counts;
  },

  /** Both scans' matches come from the enabled signatures, so a difference is a real change. */
  async comparable(scanId: string, baseId: string): Promise<boolean> {
    const [states, hash] = await Promise.all([
      prisma.signatureScanState.findMany({ where: { scanId: { in: [scanId, baseId] } }, select: { setHash: true } }),
      currentSetHash(),
    ]);
    return states.length === 2 && states.every((state) => state.setHash === hash);
  },

  /** Matches per signature in a scan, with hosts the base scan's matches did not include. */
  async counts(scanId: string, baseId: string | null): Promise<ScanDetectionsResponse> {
    const [rows, state, hash] = await Promise.all([
      prisma.$queryRaw<
        (SignatureRow & { hosts: number; services: number; newHosts: number })[]
      >`
        WITH current AS (
          SELECT m."signatureId", s."hostId", m."serviceId"
          FROM "SignatureMatch" m JOIN "Service" s ON s.id = m."serviceId"
          WHERE m."scanId" = ${scanId}::uuid
        ), base AS (
          SELECT DISTINCT m."signatureId", s."hostId"
          FROM "SignatureMatch" m JOIN "Service" s ON s.id = m."serviceId"
          WHERE ${baseId === null ? Prisma.sql`false` : Prisma.sql`m."scanId" = ${baseId}::uuid`}
        )
        SELECT g.id, g.key, g.name, g.category, g.product, g.severity,
          count(DISTINCT c."hostId")::int AS hosts,
          count(DISTINCT c."serviceId")::int AS services,
          count(DISTINCT c."hostId") FILTER (WHERE b."hostId" IS NULL)::int AS "newHosts"
        FROM current c
        JOIN "Signature" g ON g.id = c."signatureId" AND g.enabled
        LEFT JOIN base b ON b."signatureId" = c."signatureId" AND b."hostId" = c."hostId"
        GROUP BY g.id`,
      prisma.signatureScanState.findUnique({ where: { scanId }, select: { setHash: true } }),
      currentSetHash(),
    ]);
    return {
      evaluated: state?.setHash === hash,
      items: rows
        .map((row) => {
          const { confidence: _confidence, version: _version, ...summary } = summaryOf(row, {
            confidence: "low",
            version: null,
          });
          return { ...summary, hosts: row.hosts, services: row.services, newHosts: baseId === null ? 0 : row.newHosts };
        })
        .toSorted((a, b) => rank(b.severity) - rank(a.severity) || b.hosts - a.hosts || a.name.localeCompare(b.name)),
    };
  },
};
