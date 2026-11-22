import { parsePortSpec, portsOutside } from "@subsurf/contracts/scans/port-spec";
import { cidrToRange, ipv4ToInt, parseCidr, type Ipv4Range } from "@subsurf/contracts/targets/ipv4";

/** `ScanJob.targets` holds CIDRs and bare addresses. */
function targetRange(target: string): Ipv4Range {
  if (target.includes("/")) return cidrToRange(parseCidr(target));
  const address = ipv4ToInt(target);
  return { start: address, end: address };
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
  return portsOutside(parsePortSpec(spec), ports);
}
