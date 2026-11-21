import type { QueuedScan, ScanJobHost } from "@hacknation/contracts/scans/scans.schema";
import { ipv4ToInt, type Ipv4Range } from "@hacknation/contracts/targets/ipv4";
import { parseTargetValue, type TargetKind } from "@hacknation/contracts/targets/target-input";
import type { ImportWarning } from "@hacknation/contracts/targets/targets.schema";

import { env } from "~backend/config/env";
import type { Prisma } from "~backend/generated/prisma/client";
import type { AuthContext } from "~backend/lib/auth-context";
import { chunks } from "~backend/lib/chunks";
import { planScanJobs } from "~backend/modules/scans/batching";
import type { DnsResolution } from "~backend/modules/scans/dns";
import { toQueuedScan } from "~backend/modules/scans/scans.mapper";

const INSERT_BATCH = 2000;

export interface ScanTargetRow {
  id: string;
  kind: TargetKind;
  value: string;
}

export interface QueueScanResult {
  scan: QueuedScan | null;
  warnings: ImportWarning[];
}

function targetRange(target: ScanTargetRow): Ipv4Range | null {
  const parsed = parseTargetValue(target.value);
  return parsed.ok ? parsed.range : null;
}

export const scansService = {
  /**
   * Queues a scan of inventory targets: a Scan with the env defaults snapshotted, the targets it
   * covers and its jobs. Domains must be resolved beforehand (`resolveDomains`), outside `tx`.
   */
  async queue(
    tx: Prisma.TransactionClient,
    auth: AuthContext,
    targets: readonly ScanTargetRow[],
    dns: DnsResolution,
  ): Promise<QueueScanResult> {
    const hosts: ScanJobHost[] = dns.resolved.flatMap(({ domain, addresses }) =>
      addresses.map((ip) => ({ ip, domain })),
    );
    const ranges: Ipv4Range[] = [
      ...targets.flatMap((target) => targetRange(target) ?? []),
      ...hosts.map((host) => ({ start: ipv4ToInt(host.ip), end: ipv4ToInt(host.ip) })),
    ];
    const jobs = planScanJobs(ranges, hosts, env.SCAN_BATCH_SIZE);
    if (jobs.length === 0) {
      return { scan: null, warnings: [...dns.warnings, { code: "no_scannable_targets", value: "" }] };
    }

    const scan = await tx.scan.create({
      data: {
        ports: env.SCAN_DEFAULT_PORTS,
        maxRate: env.SCAN_DEFAULT_MAX_RATE,
        batchSize: env.SCAN_BATCH_SIZE,
        targetCount: targets.length,
        addressCount: jobs.reduce((sum, job) => sum + job.addressCount, 0),
        jobCount: jobs.length,
        warnings: dns.warnings,
        requestedById: auth.user.id,
      },
    });
    for (const batch of chunks(targets, INSERT_BATCH)) {
      await tx.scanTarget.createMany({
        data: batch.map((target) => ({ scanId: scan.id, targetId: target.id })),
      });
    }
    for (const [index, batch] of [...chunks(jobs, INSERT_BATCH)].entries()) {
      await tx.scanJob.createMany({
        data: batch.map((job, position) => ({
          scanId: scan.id,
          sequence: index * INSERT_BATCH + position + 1,
          subnet: job.subnet,
          targets: job.targets,
          hosts: job.hosts,
          addressCount: job.addressCount,
        })),
      });
    }

    return { scan: toQueuedScan(scan), warnings: dns.warnings };
  },
};
