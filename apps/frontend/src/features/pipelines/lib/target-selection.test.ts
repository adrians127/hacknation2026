import { describe, expect, it } from "vitest";

import type { Target } from "@subsurf/contracts/targets/targets.schema";

import { inventoryTags, selectionCoverage } from "@/features/pipelines/lib/target-selection";

const target = (id: string, kind: Target["kind"], value: string, tags: string[] = []): Target => ({
  id,
  kind,
  value,
  note: "",
  tags,
  activeHosts: 0,
  lastScanId: null,
  lastScanAt: null,
  createdAt: "2026-11-22T00:00:00.000Z",
});

const INVENTORY = [
  target("a", "cidr", "10.0.0.0/24", ["lab"]),
  target("b", "ip", "10.0.1.5", ["lab", "dmz"]),
  target("c", "cidr", "10.9.0.0/24"),
  target("d", "domain", "app.example.com", ["web"]),
];

describe("selectionCoverage", () => {
  it("takes every target when nothing is selected", () => {
    const coverage = selectionCoverage(INVENTORY, { tags: [], targetIds: [] }, []);
    expect(coverage.targets.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    expect(coverage).toMatchObject({ addresses: 513, domains: 1 });
  });

  it("adds targets picked by id to the tagged ones", () => {
    const coverage = selectionCoverage(INVENTORY, { tags: ["lab"], targetIds: ["c"] }, []);
    expect(coverage.targets.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(coverage).toMatchObject({ addresses: 513, domains: 0 });
  });

  it("counts only the addresses inside the ranges", () => {
    expect(selectionCoverage(INVENTORY, { tags: ["lab"], targetIds: [] }, ["10.0.0.128/25"]).addresses).toBe(128);
    expect(selectionCoverage(INVENTORY, { tags: ["lab"], targetIds: [] }, ["192.0.2.0/24"]).addresses).toBe(0);
  });

  it("reports tags no target carries and targets gone from the inventory", () => {
    const coverage = selectionCoverage(INVENTORY, { tags: ["lab", "Lab"], targetIds: ["a", "gone"] }, []);
    expect(coverage).toMatchObject({ missingTags: ["Lab"], missingIds: ["gone"] });
  });
});

describe("inventoryTags", () => {
  it("counts the targets per tag, by name", () => {
    expect(inventoryTags(INVENTORY)).toEqual([
      { tag: "dmz", count: 1 },
      { tag: "lab", count: 2 },
      { tag: "web", count: 1 },
    ]);
  });
});
