import {
  DefectDojoPushStatsSchema,
  DefectDojoSyncStatsSchema,
  type DefectDojoPush,
  type DefectDojoSync,
  type ServiceRemediation,
} from "@subsurf/contracts/defectdojo/defectdojo.schema";

import type { Prisma, Service } from "~backend/generated/prisma/client";

export const SYNC_INCLUDE = {
  startedBy: { select: { id: true, displayName: true } },
} as const satisfies Prisma.DefectDojoSyncInclude;

type SyncRow = Prisma.DefectDojoSyncGetPayload<{ include: typeof SYNC_INCLUDE }>;

export function toDefectDojoSync(row: SyncRow): DefectDojoSync {
  const stats = DefectDojoSyncStatsSchema.safeParse(row.stats);
  return {
    id: row.id,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    startedBy: row.startedBy,
    stats: stats.success ? stats.data : null,
    error: row.error,
  };
}

const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

export function toServiceRemediation(
  service: Pick<Service, "remediationPlannedOn" | "slaDueOn" | "riskAcceptedUntil">,
): ServiceRemediation | null {
  const remediation = {
    plannedOn: day(service.remediationPlannedOn),
    slaDueOn: day(service.slaDueOn),
    riskAcceptedUntil: day(service.riskAcceptedUntil),
  };
  return Object.values(remediation).some((value) => value !== null) ? remediation : null;
}

export const PUSH_INCLUDE = SYNC_INCLUDE satisfies Prisma.DefectDojoPushInclude;

type PushRow = Prisma.DefectDojoPushGetPayload<{ include: typeof PUSH_INCLUDE }>;

export function toDefectDojoPush(row: PushRow): DefectDojoPush {
  const stats = DefectDojoPushStatsSchema.safeParse(row.stats);
  return {
    id: row.id,
    scanId: row.scanId,
    scope: row.scope,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    startedBy: row.startedBy,
    findings: row.findings,
    testId: row.testId,
    stats: stats.success ? stats.data : null,
    error: row.error,
  };
}
