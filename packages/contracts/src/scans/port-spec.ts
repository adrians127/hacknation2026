/** An inclusive run of TCP ports. */
export interface PortRange {
  from: number;
  to: number;
}

/** Expects a valid spec (`PortSpecSchema`), e.g. `22,80,8000-8100`. */
export function parsePortSpec(spec: string): PortRange[] {
  return spec.split(",").map((part) => {
    const [from = 0, to = from] = part.split("-").map(Number);
    return { from, to };
  });
}

/** Sorted, with overlapping and adjacent runs joined. */
export function mergePortRanges(ranges: readonly PortRange[]): PortRange[] {
  const merged: PortRange[] = [];
  for (const range of ranges.toSorted((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

/** A normalized spec; an empty list has none, so the result is `null`. */
export function formatPortSpec(ranges: readonly PortRange[]): string | null {
  const parts = mergePortRanges(ranges).map(({ from, to }) => (from === to ? `${from}` : `${from}-${to}`));
  return parts.length > 0 ? parts.join(",") : null;
}

export function portsOutside(ranges: readonly PortRange[], ports: readonly number[]): number[] {
  return ports.filter((port) => !ranges.some((range) => port >= range.from && port <= range.to));
}
