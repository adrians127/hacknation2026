import { selectorRanges } from "@subsurf/contracts/hosts/host-selectors";
import type { TargetSelector } from "@subsurf/contracts/pipelines/pipelines.schema";
import type { Ipv4Range } from "@subsurf/contracts/targets/ipv4";

import { prisma } from "~backend/lib/prisma";
import type { ScanTargetRow } from "~backend/modules/pipelines/queue-run";

/** Inventory targets with any of the selector's tags or picked by id (every target without either). */
export async function selectTargets(selector: TargetSelector): Promise<ScanTargetRow[]> {
  const picks = [
    ...(selector.tags.length > 0 ? [{ tags: { hasSome: selector.tags } }] : []),
    ...(selector.targetIds.length > 0 ? [{ id: { in: selector.targetIds } }] : []),
  ];
  return prisma.target.findMany({
    where: picks.length > 0 ? { OR: picks } : {},
    select: { id: true, kind: true, value: true },
    orderBy: { value: "asc" },
  });
}

/** `undefined` (no narrowing) for a selector without ranges. */
export function selectorWithin(selector: TargetSelector): Ipv4Range[] | undefined {
  return selector.ranges.length > 0 ? selectorRanges(selector.ranges) : undefined;
}
