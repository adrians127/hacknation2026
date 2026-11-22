import { describe, expect, it } from "vitest";

import { buildVisualizationTree, visibleVisualizationTree, type VisualizationBranch } from "./visualization-tree";

const host = (ip: string, id: string) => ({ id, ip, status: "up" as const });

function leaves(branch: VisualizationBranch): string[] {
  return branch.kind === "host" ? [branch.ip] : branch.children.flatMap(leaves);
}

describe("scan visualization tree", () => {
  it("shows only scanned IPs and compresses prefixes without single-child groups", () => {
    const ips = ["10.0.5.7", "10.0.5.8", "192.0.2.10"];
    const tree = buildVisualizationTree(ips.map((ip, index) => host(ip, String(index))));
    expect(tree).not.toBeNull();
    expect(leaves(tree!)).toEqual(ips);
    expect(tree?.kind).toBe("prefix");
    if (tree?.kind !== "prefix") return;
    expect(tree.cidr).toBe("0.0.0.0/0");
    expect(tree.children[0].kind).toBe("prefix");
    expect(visibleVisualizationTree(tree, new Set())).toHaveLength(1);
    expect(visibleVisualizationTree(tree, new Set([tree.id]))).toHaveLength(3);
  });

  it("renders a single host directly and handles an empty scan", () => {
    expect(buildVisualizationTree([])).toBeNull();
    const tree = buildVisualizationTree([host("10.40.1.9", "one")]);
    expect(tree).toMatchObject({ kind: "host", ip: "10.40.1.9", count: 1 });
    expect(visibleVisualizationTree(tree, new Set())).toHaveLength(1);
  });

  it("keeps a large scan collapsed until groups are opened", () => {
    const hosts = Array.from({ length: 10_000 }, (_, index) =>
      host(`10.40.${Math.floor(index / 256)}.${index % 256}`, String(index)),
    );
    const tree = buildVisualizationTree(hosts);
    expect(tree?.count).toBe(10_000);
    expect(visibleVisualizationTree(tree, new Set())).toHaveLength(1);
  });
});
