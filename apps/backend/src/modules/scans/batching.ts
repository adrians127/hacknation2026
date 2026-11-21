import type { ScanJobHost } from "@hacknation/contracts/scans/scans.schema";
import {
  coveringCidr,
  formatCidr,
  ipv4ToInt,
  mergeRanges,
  rangeSize,
  rangeToCidrs,
  type Ipv4Range,
} from "@hacknation/contracts/targets/ipv4";

export interface ScanJobPlan {
  subnet: string;
  targets: string[];
  hosts: ScanJobHost[];
  addressCount: number;
}

// A job never spans two /16 blocks, so packing scattered addresses keeps its subnet small.
const GROUP_SIZE = 2 ** 16;

/**
 * Splits the addresses into jobs of at most `batchSize` addresses, in address order: a /16
 * becomes /24 jobs (with 256), while scattered addresses of one /16 share a job.
 */
export function planScanJobs(
  ranges: readonly Ipv4Range[],
  hosts: readonly ScanJobHost[],
  batchSize: number,
): ScanJobPlan[] {
  const batches: Ipv4Range[][] = [];
  let batch: Ipv4Range[] = [];
  let batchAddresses = 0;
  let group = -1;
  const flush = () => {
    if (batch.length > 0) batches.push(batch);
    batch = [];
    batchAddresses = 0;
  };

  for (const range of mergeRanges(ranges)) {
    let start = range.start;
    while (start <= range.end) {
      const startGroup = Math.floor(start / GROUP_SIZE);
      if (startGroup !== group) {
        flush();
        group = startGroup;
      }
      const end = Math.min(
        range.end,
        (startGroup + 1) * GROUP_SIZE - 1,
        start + (batchSize - batchAddresses) - 1,
      );
      batch.push({ start, end });
      batchAddresses += end - start + 1;
      if (batchAddresses === batchSize) flush();
      start = end + 1;
    }
  }
  flush();

  const sortedHosts = hosts
    .map((host) => ({ host, address: ipv4ToInt(host.ip) }))
    .toSorted((a, b) => a.address - b.address);
  let nextHost = 0;

  return batches.map((parts) => {
    const span = { start: parts[0].start, end: parts[parts.length - 1].end };
    const batchHosts: ScanJobHost[] = [];
    // Batches are disjoint and in address order, and every host address is in some batch.
    while (nextHost < sortedHosts.length && sortedHosts[nextHost].address <= span.end) {
      batchHosts.push(sortedHosts[nextHost].host);
      nextHost += 1;
    }
    return {
      subnet: formatCidr(coveringCidr(span)),
      targets: parts.flatMap((part) => rangeToCidrs(part).map(formatCidr)),
      hosts: batchHosts,
      addressCount: parts.reduce((sum, part) => sum + rangeSize(part), 0),
    };
  });
}
