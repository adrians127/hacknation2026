import { selectorRanges } from "@subsurf/contracts/hosts/host-selectors";
import { intersectRanges, mergeRanges, rangeSize, type Ipv4Range } from "@subsurf/contracts/targets/ipv4";
import { parseTargetValue } from "@subsurf/contracts/targets/target-input";
import type { Target } from "@subsurf/contracts/targets/targets.schema";

export interface TargetSelection {
  tags: string[];
  targetIds: string[];
}

export interface SelectionCoverage {
  /** Inventory targets a run would take, before the ranges narrow them. */
  targets: Target[];
  /** IPv4 addresses of those targets left after the ranges. */
  addresses: number;
  /** Their addresses are only known once a run resolves them. */
  domains: number;
  /** Selected tags that no target carries. */
  missingTags: string[];
  /** Selected targets no longer in the inventory. */
  missingIds: string[];
}

/** What the backend's `selectTargets` + `queueRun` would scan, as far as the browser can tell. */
export function selectionCoverage(
  inventory: readonly Target[],
  { tags, targetIds }: TargetSelection,
  ranges: readonly string[],
): SelectionCoverage {
  const tagSet = new Set(tags);
  const idSet = new Set(targetIds);
  const targets =
    tagSet.size === 0 && idSet.size === 0
      ? [...inventory]
      : inventory.filter((target) => idSet.has(target.id) || target.tags.some((tag) => tagSet.has(tag)));

  const blocks: Ipv4Range[] = [];
  for (const target of targets) {
    if (target.kind === "domain") continue;
    const parsed = parseTargetValue(target.value);
    if (parsed.ok && parsed.range) blocks.push(parsed.range);
  }
  const kept = ranges.length > 0 ? intersectRanges(blocks, selectorRanges(ranges)) : mergeRanges(blocks);

  const known = new Set(inventory.map((target) => target.id));
  const carried = new Set(inventory.flatMap((target) => target.tags));
  return {
    targets,
    addresses: kept.reduce((sum, range) => sum + rangeSize(range), 0),
    domains: targets.filter((target) => target.kind === "domain").length,
    missingTags: tags.filter((tag) => !carried.has(tag)),
    missingIds: targetIds.filter((id) => !known.has(id)),
  };
}

/** Each tag of the inventory with how many targets carry it, by name. */
export function inventoryTags(inventory: readonly Target[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const target of inventory) {
    for (const tag of target.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .toSorted((a, b) => a.tag.localeCompare(b.tag));
}
