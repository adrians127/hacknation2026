import { unionPortSpecs } from "@subsurf/contracts/scans/port-spec";
import {
  importedRanges,
  type ImportedScanFacts,
  type ScanImport,
} from "@subsurf/contracts/scans/scan-import";
import type { ScanHostCounts } from "@subsurf/contracts/scans/scans.schema";
import {
  cidrToRange,
  coveringCidr,
  formatCidr,
  intToIpv4,
  ipv4ToInt,
  mergeRanges,
  parseCidr,
  rangeToCidrs,
  type Ipv4Range,
} from "@subsurf/contracts/targets/ipv4";
import type {
  ObservedHost,
  WorkerResult,
  WorkerScan,
} from "@subsurf/contracts/workers/worker-result.schema";

import { planScanJobs } from "~backend/modules/scans/batching";

/** A result still without the ids the database gives its scan, job and lease. */
export interface PlannedResult {
  scan: Omit<WorkerScan, "scanId" | "jobId" | "leaseId">;
  hosts: ObservedHost[];
}

export interface PlannedJob {
  subnet: string;
  targets: string[];
  addressCount: number;
  result: PlannedResult;
}

export interface ScanImportPlan {
  scan: {
    status: ImportedScanFacts["status"];
    /** `null`: the file does not say when the scan ran. */
    createdAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    /** `null`: nothing recorded and no open port to derive it from. */
    ports: string | null;
    maxRate: number | null;
    addressCount: number;
  };
  jobs: PlannedJob[];
  hosts: ScanHostCounts;
  openPorts: number;
  /** What makes two files the same import, whatever ids, export time or edits they carry. */
  identity: unknown;
}

export interface PlanOptions {
  batchSize: number;
  now: Date;
}

const IMPORT_WORKER = { id: "import", version: "1", nmapVersion: null } as const;
const NO_PHASES = { hostDiscovery: 0, portScan: 0, serviceDetection: 0, http: 0 } as const;

const dateOrNull = (value: string | null) => (value === null ? null : new Date(value));

function countHosts(hosts: readonly ObservedHost[]): ScanHostCounts {
  const counts: ScanHostCounts = { up: 0, down: 0, timeout: 0, cancelled: 0, failed: 0 };
  for (const host of hosts) counts[host.status] += 1;
  return counts;
}

const openPortsOf = (hosts: readonly ObservedHost[]) =>
  hosts.reduce((sum, host) => sum + host.ports.length, 0);

/** The recorded spec widened by every port seen open, so ingest's scope check holds. */
function scannedPorts(specs: readonly (string | null)[], hosts: readonly ObservedHost[]): string | null {
  const parts = [
    ...specs.flatMap((spec) => (spec === null ? [] : [spec])),
    ...hosts.flatMap((host) => host.ports.map(({ port }) => String(port))),
  ];
  return parts.length > 0 ? unionPortSpecs(parts) : null;
}

function targetRange(target: string): Ipv4Range {
  if (target.includes("/")) return cidrToRange(parseCidr(target));
  const address = ipv4ToInt(target);
  return { start: address, end: address };
}

const subnetOrNull = (subnet: string) => (subnet.includes("/") ? subnet : null);

/** One result per planned job: the file's hosts, and `down` for the covered rest. */
function planDocument(
  read: Extract<ScanImport, { inputFormat: "subsurf-scan" | "csv" }>,
  { batchSize, now }: PlanOptions,
): ScanImportPlan {
  const createdAt = dateOrNull(read.scan.createdAt ?? read.scan.startedAt);
  const startedAt = dateOrNull(read.scan.startedAt) ?? createdAt ?? now;
  const finishedAt = dateOrNull(read.scan.finishedAt) ?? startedAt;
  const ports = scannedPorts([read.scan.ports], read.hosts);
  const byAddress = new Map(read.hosts.map((host) => [ipv4ToInt(host.ip), host]));
  const down = (address: number): ObservedHost => ({
    ip: intToIpv4(address),
    status: "down",
    reason: null,
    observedAt: finishedAt.toISOString(),
    latencyMs: null,
    hostnames: [],
    error: null,
    ports: [],
  });

  const jobs = planScanJobs(importedRanges(read.coverage, read.hosts), [], batchSize).map(
    (job): PlannedJob => {
      const hosts: ObservedHost[] = [];
      for (const { start, end } of job.targets.map(targetRange)) {
        for (let address = start; address <= end; address += 1) {
          hosts.push(byAddress.get(address) ?? down(address));
        }
      }
      const counts = countHosts(hosts);
      const answered = counts.up + counts.down === hosts.length;
      return {
        subnet: job.subnet,
        targets: job.targets,
        addressCount: job.addressCount,
        result: {
          scan: {
            worker: IMPORT_WORKER,
            status: answered ? "completed" : "partial",
            stopReason: null,
            startedAt: startedAt.toISOString(),
            finishedAt: finishedAt.toISOString(),
            durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
            phasesMs: NO_PHASES,
            // Nothing ran here: only what the file records is known.
            params: {
              subnet: subnetOrNull(job.subnet),
              ports,
              maxParallel: null,
              maxRatePerProcess: null,
              hostTimeoutMs: null,
              httpTimeoutMs: null,
              maxBodyBytes: null,
              maxRedirects: null,
              nmapArgs: [],
            },
            counts: {
              addresses: hosts.length,
              ...counts,
              openPorts: openPortsOf(hosts),
              httpEndpoints: hosts.reduce(
                (sum, host) => sum + host.ports.reduce((count, port) => count + port.http.length, 0),
                0,
              ),
              httpRequests: 0,
            },
            error: null,
          },
          hosts,
        },
      };
    },
  );

  const all = jobs.flatMap((job) => job.result.hosts);
  return {
    scan: {
      status: read.scan.status,
      createdAt,
      startedAt: dateOrNull(read.scan.startedAt),
      finishedAt: dateOrNull(read.scan.finishedAt),
      ports,
      maxRate: read.scan.maxRate,
      addressCount: all.length,
    },
    jobs,
    hosts: countHosts(all),
    openPorts: openPortsOf(all),
    identity: {
      format: "scan",
      coverage: importedRanges(read.coverage, read.hosts),
      hosts: read.hosts.toSorted((a, b) => ipv4ToInt(a.ip) - ipv4ToInt(b.ip)),
    },
  };
}

/** One job per worker result, replayed as it is: worker, timing and parameters are the file's. */
function planWorkerResults(results: readonly WorkerResult[]): ScanImportPlan {
  const jobs = results.map((result): PlannedJob => {
    const ranges = mergeRanges(
      result.hosts.map((host) => ({ start: ipv4ToInt(host.ip), end: ipv4ToInt(host.ip) })),
    );
    const { scanId: _scanId, jobId: _jobId, leaseId: _leaseId, ...scan } = result.scan;
    return {
      subnet: formatCidr(coveringCidr({ start: ranges[0].start, end: ranges[ranges.length - 1].end })),
      targets: ranges.flatMap(rangeToCidrs).map(formatCidr),
      addressCount: result.hosts.length,
      result: { scan, hosts: result.hosts },
    };
  });

  // Several results may report one address (worker stages): `up` wins, as in the scan view.
  const best = new Map<string, ObservedHost>();
  for (const host of results.flatMap((result) => result.hosts)) {
    const known = best.get(host.ip);
    if (!known || (known.status !== "up" && host.status === "up")) best.set(host.ip, host);
  }
  const all = [...best.values()];
  const startedAt = results.map((result) => result.scan.startedAt).toSorted()[0] ?? null;
  const finishedAt = results.map((result) => result.scan.finishedAt).toSorted().at(-1) ?? null;
  const cut = results.some(
    ({ scan }) => scan.stopReason === "deadline" || scan.stopReason === "stop-requested",
  );
  return {
    scan: {
      status: results.every(({ scan }) => scan.status === "failed") ? "failed" : cut ? "stopped" : "completed",
      createdAt: dateOrNull(startedAt),
      startedAt: dateOrNull(startedAt),
      finishedAt: dateOrNull(finishedAt),
      ports: scannedPorts(
        results.map((result) => result.scan.params.ports),
        results.flatMap((result) => result.hosts),
      ),
      maxRate: null,
      addressCount: all.length,
    },
    jobs,
    hosts: countHosts(all),
    // Stages repeat a host's ports: count each port once.
    openPorts: new Set(
      results.flatMap((result) =>
        result.hosts.flatMap((host) => host.ports.map((port) => `${host.ip}/${port.protocol}/${port.port}`)),
      ),
    ).size,
    identity: { format: "results", results: jobs.map((job) => job.result) },
  };
}

/** How a results file becomes a scan: its row, its jobs and one worker result per job. */
export function planScanImport(read: ScanImport, options: PlanOptions): ScanImportPlan {
  return read.inputFormat === "worker-results"
    ? planWorkerResults(read.results)
    : planDocument(read, options);
}
