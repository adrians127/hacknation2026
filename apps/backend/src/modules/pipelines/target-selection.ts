import { selectorRanges } from "@subsurf/contracts/hosts/host-selectors";
import { TargetSelectorSchema, type TargetSelector } from "@subsurf/contracts/pipelines/pipelines.schema";
import type { Ipv4Range } from "@subsurf/contracts/targets/ipv4";

import { prisma } from "~backend/lib/prisma";
import type { ScanTargetRow, StepTargets } from "~backend/modules/pipelines/queue-run";

export function readSelector(stored: unknown): TargetSelector {
  // Selectors saved before `targetIds` existed lack it.
  const withIds = typeof stored === "object" && stored !== null ? { targetIds: [], ...stored } : stored;
  const parsed = TargetSelectorSchema.safeParse(withIds);
  return parsed.success ? parsed.data : { tags: [], targetIds: [], ranges: [] };
}

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

/** What each step that scans targets covers, by step index. */
export async function selectStepTargets(
  steps: readonly { index: number; targets: TargetSelector | null }[],
): Promise<Map<number, StepTargets>> {
  const byStep = new Map<number, StepTargets>();
  for (const { index, targets: selector } of steps) {
    if (!selector) continue;
    byStep.set(index, { targets: await selectTargets(selector), within: selectorWithin(selector) });
  }
  return byStep;
}

/** Every domain the steps cover, once, for a single `resolveDomains` call. */
export function stepDomains(byStep: ReadonlyMap<number, StepTargets>): string[] {
  const domains = new Set<string>();
  for (const { targets } of byStep.values()) {
    for (const target of targets) if (target.kind === "domain") domains.add(target.value);
  }
  return [...domains];
}
