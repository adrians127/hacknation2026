import type { Target } from "@subsurf/contracts/targets/targets.schema";

import type { TargetKind } from "~backend/generated/prisma/client";

export interface TargetRow {
  id: string;
  kind: TargetKind;
  value: string;
  note: string;
  tags: string[];
  createdAt: Date;
  lastScanAt: Date | null;
  activeHosts: number;
}

export function toTarget(row: TargetRow): Target {
  return {
    id: row.id,
    kind: row.kind,
    value: row.value,
    note: row.note,
    tags: row.tags,
    activeHosts: row.activeHosts,
    lastScanAt: row.lastScanAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
