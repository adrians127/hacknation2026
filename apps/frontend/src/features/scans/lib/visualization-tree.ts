import type { ScanVisualizationHostsResponse } from "@subsurf/contracts/scans/scan-results.schema";

type Host = ScanVisualizationHostsResponse["items"][number];

export type VisualizationBranch =
  | { kind: "host"; id: string; ip: string; status: Host["status"]; count: 1 }
  | { kind: "prefix"; id: string; cidr: string; count: number; children: [VisualizationBranch, VisualizationBranch] };

const numberOf = (ip: string) => {
  const [a = 0, b = 0, c = 0, d = 0] = ip.split(".").map(Number);
  return (a * 2 ** 24 + b * 2 ** 16 + c * 2 ** 8 + d) >>> 0;
};

const ipOf = (value: number) =>
  [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");

/** A compressed IPv4 radix tree: no unary branches and no unobserved address leaves. */
export function buildVisualizationTree(hosts: readonly Host[]): VisualizationBranch | null {
  if (hosts.length === 0) return null;
  const sorted = hosts.map((host) => ({ host, address: numberOf(host.ip) })).toSorted((a, b) => a.address - b.address);

  function branch(items: typeof sorted): VisualizationBranch {
    if (items.length === 1) {
      const { host } = items[0];
      return { kind: "host", id: `host:${host.id}`, ip: host.ip, status: host.status, count: 1 };
    }
    const first = items[0].address;
    const last = items[items.length - 1].address;
    const prefix = Math.clz32((first ^ last) >>> 0);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const cidr = `${ipOf((first & mask) >>> 0)}/${prefix}`;
    const bit = 2 ** (31 - prefix);
    const split = items.findIndex((item) => (item.address & bit) !== 0);
    return {
      kind: "prefix",
      id: `prefix:${cidr}`,
      cidr,
      count: items.length,
      children: [branch(items.slice(0, split)), branch(items.slice(split))],
    };
  }

  return branch(sorted);
}

/** The concrete scanned hosts below a node, independent of its displayed CIDR. */
export function visualizationHostIps(branch: VisualizationBranch): string[] {
  const ips: string[] = [];
  const pending = [branch];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;
    if (current.kind === "host") ips.push(current.ip);
    else pending.push(...current.children);
  }
  return ips;
}

export interface VisibleBranch {
  branch: VisualizationBranch;
  x: number;
  y: number;
  parentId: string;
}

/** Only expanded branches take layout space; x is centered over visible children. */
export function visibleVisualizationTree(
  tree: VisualizationBranch | null,
  expanded: ReadonlySet<string>,
): VisibleBranch[] {
  if (!tree) return [];
  const result: VisibleBranch[] = [];
  let leaf = 0;
  function visit(branch: VisualizationBranch, depth: number, parentId: string): number {
    const open = branch.kind === "prefix" && expanded.has(branch.id);
    const childXs = open ? branch.children.map((child) => visit(child, depth + 1, branch.id)) : [];
    const x = childXs.length > 0 ? (childXs[0] + childXs[1]) / 2 : leaf++;
    result.push({ branch, x, y: depth, parentId });
    return x;
  }
  visit(tree, 1, "scan");
  return result;
}
