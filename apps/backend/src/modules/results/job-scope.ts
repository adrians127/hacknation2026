import { cidrToRange, ipv4ToInt, parseCidr, type Ipv4Range } from "@subsurf/contracts/targets/ipv4";

interface PortRange {
  from: number;
  to: number;
}

/** `ScanJob.targets` holds CIDRs and bare addresses. */
function targetRange(target: string): Ipv4Range {
  if (target.includes("/")) return cidrToRange(parseCidr(target));
  const address = ipv4ToInt(target);
  return { start: address, end: address };
}

/** A valid port spec (`PortSpecSchema`), e.g. `22,80,8000-8100`. */
function portRanges(spec: string): PortRange[] {
  return spec.split(",").map((part) => {
    const [from = 0, to = from] = part.split("-").map(Number);
    return { from, to };
  });
}

/** Addresses a result reports although the job never asked for them. */
export function addressesOutsideJob(targets: readonly string[], ips: readonly string[]): string[] {
  const ranges = targets.map(targetRange);
  return ips.filter((ip) => {
    const address = ipv4ToInt(ip);
    return !ranges.some((range) => address >= range.start && address <= range.end);
  });
}

/** Ports a result reports open although the scan's port spec excludes them. */
export function portsOutsideSpec(spec: string, ports: readonly number[]): number[] {
  const ranges = portRanges(spec);
  return ports.filter((port) => !ranges.some((range) => port >= range.from && port <= range.to));
}
