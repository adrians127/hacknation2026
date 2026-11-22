// Shared by the pipeline editor (port presets, allowed-ports hint) and the backend (scan ports,
// SCAN_ALLOWED_PORTS). Expects specs already valid against `PortSpecSchema`.

export interface PortRange {
  from: number;
  to: number;
}

export function portSpecRanges(spec: string): PortRange[] {
  const ranges = spec.split(",").map((part) => {
    const [from = 0, to = from] = part.split("-").map(Number);
    return { from, to };
  });
  return mergePortRanges(ranges);
}

function mergePortRanges(ranges: readonly PortRange[]): PortRange[] {
  const sorted = ranges.toSorted((a, b) => a.from - b.from);
  const merged: PortRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

export function formatPortRanges(ranges: readonly PortRange[]): string {
  return ranges.map(({ from, to }) => (from === to ? `${from}` : `${from}-${to}`)).join(",");
}

/** One normalized spec covering every port of the given specs. */
export function unionPortSpecs(specs: readonly string[]): string {
  return formatPortRanges(mergePortRanges(specs.flatMap(portSpecRanges)));
}

export function portSpecSize(spec: string): number {
  return portSpecRanges(spec).reduce((sum, { from, to }) => sum + to - from + 1, 0);
}

export function isPortInSpec(port: number, ranges: readonly PortRange[]): boolean {
  return ranges.some(({ from, to }) => port >= from && port <= to);
}

/** Whether every port of `spec` is also in `allowed`. */
export function isPortSpecWithin(spec: string, allowed: string): boolean {
  const allowedRanges = portSpecRanges(allowed);
  return portSpecRanges(spec).every(({ from, to }) =>
    allowedRanges.some((range) => from >= range.from && to <= range.to),
  );
}
