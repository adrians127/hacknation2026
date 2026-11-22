import { selectorRanges } from "@subsurf/contracts/hosts/host-selectors";
import type { TargetSelector } from "@subsurf/contracts/pipelines/pipelines.schema";
import { mergeRanges, type Ipv4Range } from "@subsurf/contracts/targets/ipv4";

import { prisma } from "~backend/lib/prisma";
import type { ScanTargetRow } from "~backend/modules/pipelines/queue-run";

/** Inventory targets with any of the selector's tags (every target without tags). */
export async function selectTargets(selector: TargetSelector): Promise<ScanTargetRow[]> {
  return prisma.target.findMany({
    where: selector.tags.length > 0 ? { tags: { hasSome: selector.tags } } : {},
    select: { id: true, kind: true, value: true },
    orderBy: { value: "asc" },
  });
}

/** `undefined` (no narrowing) for a selector without ranges. */
export function selectorWithin(selector: TargetSelector): Ipv4Range[] | undefined {
  return selector.ranges.length > 0 ? selectorRanges(selector.ranges) : undefined;
}

/** The parts of `ranges` inside `within`; both are merged first. */
export function intersectRanges(
  ranges: readonly Ipv4Range[],
  within: readonly Ipv4Range[],
): Ipv4Range[] {
  const left = mergeRanges(ranges);
  const right = mergeRanges(within);
  const result: Ipv4Range[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const start = Math.max(left[i].start, right[j].start);
    const end = Math.min(left[i].end, right[j].end);
    if (start <= end) result.push({ start, end });
    if (left[i].end < right[j].end) i += 1;
    else j += 1;
  }
  return result;
}
