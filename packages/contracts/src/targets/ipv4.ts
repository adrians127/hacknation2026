/**
 * IPv4 arithmetic on addresses as unsigned integers (0 … 2^32 − 1). Plain arithmetic
 * instead of bitwise operators: JS bitwise results are signed 32-bit.
 */

/** Inclusive address interval. */
export interface Ipv4Range {
  start: number;
  end: number;
}

export interface Ipv4Cidr {
  network: number;
  prefix: number;
}

/** Expects a valid dotted quad (check with `z.ipv4()` first). */
export function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

export function intToIpv4(value: number): string {
  return [3, 2, 1, 0].map((byte) => Math.floor(value / 256 ** byte) % 256).join(".");
}

export function cidrSize(prefix: number): number {
  return 2 ** (32 - prefix);
}

/** Expects a valid `a.b.c.d/p` (check with `z.cidrv4()` first). Host bits are cleared. */
export function parseCidr(cidr: string): Ipv4Cidr {
  const [ip = "", prefix = ""] = cidr.split("/");
  const size = cidrSize(Number(prefix));
  return { network: Math.floor(ipv4ToInt(ip) / size) * size, prefix: Number(prefix) };
}

export function cidrToRange({ network, prefix }: Ipv4Cidr): Ipv4Range {
  return { start: network, end: network + cidrSize(prefix) - 1 };
}

/** A /32 is written as a bare address. */
export function formatCidr({ network, prefix }: Ipv4Cidr): string {
  return prefix === 32 ? intToIpv4(network) : `${intToIpv4(network)}/${prefix}`;
}

export function rangeSize({ start, end }: Ipv4Range): number {
  return end - start + 1;
}

/** Ranges a scanner must never touch, whatever the user enters. Private ranges stay allowed. */
export const RESERVED_IPV4_CIDRS = [
  "0.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "224.0.0.0/4",
  "240.0.0.0/4",
] as const;

const RESERVED_RANGES = RESERVED_IPV4_CIDRS.map((cidr) => cidrToRange(parseCidr(cidr)));

export function overlapsReserved(range: Ipv4Range): boolean {
  return RESERVED_RANGES.some((reserved) => range.start <= reserved.end && reserved.start <= range.end);
}

/** Sorted, with overlapping and adjacent ranges joined. */
export function mergeRanges(ranges: readonly Ipv4Range[]): Ipv4Range[] {
  const merged: Ipv4Range[] = [];
  for (const range of ranges.toSorted((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
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

/** The fewest aligned CIDR blocks that cover exactly `range`. */
export function rangeToCidrs(range: Ipv4Range): Ipv4Cidr[] {
  const cidrs: Ipv4Cidr[] = [];
  let network = range.start;
  while (network <= range.end) {
    let prefix = 32;
    while (prefix > 0) {
      const size = cidrSize(prefix - 1);
      if (network % size !== 0 || network + size - 1 > range.end) break;
      prefix -= 1;
    }
    cidrs.push({ network, prefix });
    network += cidrSize(prefix);
  }
  return cidrs;
}

/** The smallest aligned block containing the whole range. */
export function coveringCidr(range: Ipv4Range): Ipv4Cidr {
  let prefix = 32;
  while (prefix > 0 && Math.floor(range.start / cidrSize(prefix)) !== Math.floor(range.end / cidrSize(prefix))) {
    prefix -= 1;
  }
  const size = cidrSize(prefix);
  return { network: Math.floor(range.start / size) * size, prefix };
}
