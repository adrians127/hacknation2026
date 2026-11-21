import {
  cidrToRange,
  intToIpv4,
  ipv4ToInt,
  parseCidr,
} from "@subsurf/contracts/targets/ipv4";
import type {
  ObservedHost,
  OpenPort,
  WorkerResult,
} from "@subsurf/contracts/workers/worker-result.schema";

import { requestCount } from "~backend/demo/http";
import { DEMO_SCAN_PORTS, demoNetwork, type DemoHost } from "~backend/demo/network";
import type { HostContext } from "~backend/demo/ports";
import { PROFILES } from "~backend/demo/profiles";
import { createRandom } from "~backend/demo/random";

export interface DemoRun {
  number: 1 | 2;
  scanId: string;
  startedAt: string;
}

/** Two nightly runs, a day apart. Fixed ids make the seed idempotent. */
export const DEMO_RUNS = [
  { number: 1, scanId: "0193f0d0-0000-7000-8000-000000000001", startedAt: "2026-11-20T01:00:00Z" },
  { number: 2, scanId: "0193f0d0-0000-7000-8000-000000000002", startedAt: "2026-11-21T01:00:00Z" },
] as const satisfies readonly DemoRun[];

export interface DemoJob {
  id: string;
  sequence: number;
  subnet: string;
  targets: readonly string[];
}

export interface DemoJobResult {
  job: DemoJob;
  workerId: string;
  /** The job ran out of time and left the rest of its addresses unscanned. */
  hitDeadline: boolean;
  result: WorkerResult;
}

const WORKER_COUNT = 4;
const WORKER_VERSION = "0.3.0";
const NMAP_VERSION = "7.95";
const MAX_PARALLEL = 4;
/** Times MAX_PARALLEL: the scan's `maxRate` of 100 packets per second. */
const RATE_PER_PROCESS = 25;
const HOST_TIMEOUT_MS = 300_000;
const HTTP_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 524_288;
const MAX_REDIRECTS = 5;
/** The deadline cuts the second run's last job here: later addresses are `cancelled`. */
const DEADLINE_FROM_OCTET = 128;

const NMAP_ARGS = [
  "-sS",
  "-sV",
  "--version-light",
  "-T3",
  "--max-rate",
  String(RATE_PER_PROCESS),
  "--host-timeout",
  `${HOST_TIMEOUT_MS / 1000}s`,
  "-p",
  DEMO_SCAN_PORTS,
  "-oX",
  "-",
];

export const demoLeaseId = (run: DemoRun, job: DemoJob) =>
  `demo-run${run.number}-job${String(job.sequence).padStart(3, "0")}`;

const iso = (ms: number) => new Date(ms).toISOString();

function jobAddresses(job: DemoJob): string[] {
  return job.targets.flatMap((target) => {
    const { start, end } = cidrToRange(parseCidr(target.includes("/") ? target : `${target}/32`));
    return Array.from({ length: end - start + 1 }, (_, offset) => intToIpv4(start + offset));
  });
}

function hostContext(run: DemoRun, demoHost: DemoHost, observedAt: string): HostContext {
  return {
    ip: demoHost.ip,
    run: run.number,
    variant: demoHost.variant,
    label: demoHost.label,
    domains: demoHost.domains,
    observedAt,
    ttl: PROFILES[demoHost.profile].ttl,
    changed: (change) => run.number === 2 && demoHost.changes.includes(change),
  };
}

function hostnames(demoHost: DemoHost, ports: readonly OpenPort[]): ObservedHost["hostnames"] {
  const certNames = ports
    .flatMap((port) => port.http)
    .flatMap((entry) => entry.tls?.cert.san ?? [])
    .filter((name) => !/^\d+\.\d+\.\d+\.\d+$/.test(name));
  return [
    ...demoHost.domains.map((name) => ({ name, source: "job" as const })),
    ...(demoHost.ptr ? [{ name: demoHost.ptr, source: "ptr" as const }] : []),
    ...[...new Set(certNames)].map((name) => ({ name, source: "tls-san" as const })),
  ];
}

interface Planned {
  ip: string;
  demoHost: DemoHost | undefined;
  state: "up" | "down" | "timeout" | "cancelled";
}

function plan(run: DemoRun, job: DemoJob, hitDeadline: boolean): Planned[] {
  const byIp = new Map(demoNetwork().map((demoHost) => [demoHost.ip, demoHost]));
  return jobAddresses(job).map((ip) => {
    const demoHost = byIp.get(ip);
    const cancelled = hitDeadline && Number(ip.split(".")[3]) >= DEADLINE_FROM_OCTET;
    return { ip, demoHost, state: cancelled ? "cancelled" : (demoHost?.states[run.number] ?? "down") };
  });
}

/** Phase lengths that grow with what the job found, so batch sizing has something to learn from. */
function phases(run: DemoRun, job: DemoJob, planned: Planned[], openPorts: number, requests: number) {
  const random = createRandom(run.number * 1000 + job.sequence);
  const scanned = planned.filter((entry) => entry.state !== "cancelled").length;
  const up = planned.filter((entry) => entry.state === "up").length;
  const timedOut = planned.some((entry) => entry.state === "timeout");
  return {
    hostDiscovery: 12_000 + scanned * 95 + random.int(0, 4000),
    // A host that never answers holds the job until --host-timeout.
    portScan: 20_000 + up * 6500 + (timedOut ? HOST_TIMEOUT_MS : 0) + random.int(0, 8000),
    serviceDetection: openPorts * 2200 + random.int(0, 3000),
    http: requests * 320,
  };
}

function buildJobResult(
  run: DemoRun,
  job: DemoJob,
  workerId: string,
  startedAtMs: number,
  hitDeadline: boolean,
): WorkerResult {
  const planned = plan(run, job, hitDeadline);

  // Ports first (they size the phases), observation times once the phases are known.
  const upPorts = new Map<string, OpenPort[]>();
  for (const entry of planned) {
    if (entry.state === "up" && entry.demoHost) {
      const ctx = hostContext(run, entry.demoHost, run.startedAt);
      upPorts.set(entry.ip, PROFILES[entry.demoHost.profile].ports(ctx));
    }
  }
  const allPorts = [...upPorts.values()].flat();
  const endpoints = allPorts.flatMap((port) => port.http);
  const requests = endpoints.reduce((sum, entry) => sum + requestCount(entry), 0);
  const phasesMs = phases(run, job, planned, allPorts.length, requests);
  const durationMs =
    phasesMs.hostDiscovery + phasesMs.portScan + phasesMs.serviceDetection + phasesMs.http;

  let upIndex = 0;
  const hosts: ObservedHost[] = planned.map((entry, index) => {
    const base = { ip: entry.ip, latencyMs: null, hostnames: [], error: null, ports: [] };
    if (entry.state === "cancelled") {
      return { ...base, status: "cancelled", reason: null, observedAt: null };
    }
    if (entry.state === "timeout") {
      return {
        ...base,
        status: "timeout",
        reason: null,
        observedAt: iso(startedAtMs + phasesMs.hostDiscovery + HOST_TIMEOUT_MS),
        error: { code: "host-timeout", message: "no result within hostTimeoutMs" },
      };
    }
    if (entry.state === "down" || !entry.demoHost) {
      return {
        ...base,
        status: "down",
        reason: "no-response",
        observedAt: iso(startedAtMs + 1500 + index * 40),
      };
    }
    const observedAt = iso(
      startedAtMs + phasesMs.hostDiscovery + phasesMs.portScan + upIndex * 2200,
    );
    upIndex += 1;
    // Rebuilt with the real observation time, which the HTTP `date` header carries.
    const ports = PROFILES[entry.demoHost.profile]
      .ports(hostContext(run, entry.demoHost, observedAt))
      .toSorted((a, b) => a.port - b.port);
    return {
      ...base,
      status: "up",
      reason: "syn-ack",
      observedAt,
      latencyMs: createRandom(ipv4ToInt(entry.ip) + run.number).int(1, 24),
      hostnames: hostnames(entry.demoHost, ports),
      ports,
    };
  });

  const countOf = (status: ObservedHost["status"]) =>
    hosts.filter((observed) => observed.status === status).length;
  const inconclusive = countOf("timeout") + countOf("cancelled") + countOf("failed");

  return {
    scan: {
      jobId: job.id,
      leaseId: demoLeaseId(run, job),
      scanId: run.scanId,
      worker: { id: workerId, version: WORKER_VERSION, nmapVersion: NMAP_VERSION },
      status: inconclusive > 0 ? "partial" : "completed",
      stopReason: hitDeadline ? "deadline" : null,
      startedAt: iso(startedAtMs),
      finishedAt: iso(startedAtMs + durationMs),
      durationMs,
      phasesMs,
      params: {
        subnet: job.subnet,
        ports: DEMO_SCAN_PORTS,
        maxParallel: MAX_PARALLEL,
        maxRatePerProcess: RATE_PER_PROCESS,
        hostTimeoutMs: HOST_TIMEOUT_MS,
        httpTimeoutMs: HTTP_TIMEOUT_MS,
        maxBodyBytes: MAX_BODY_BYTES,
        maxRedirects: MAX_REDIRECTS,
        nmapArgs: NMAP_ARGS,
      },
      counts: {
        addresses: hosts.length,
        up: countOf("up"),
        down: countOf("down"),
        timeout: countOf("timeout"),
        cancelled: countOf("cancelled"),
        failed: countOf("failed"),
        openPorts: hosts.reduce((sum, observed) => sum + observed.ports.length, 0),
        httpEndpoints: hosts.reduce(
          (sum, observed) => sum + observed.ports.reduce((n, port) => n + port.http.length, 0),
          0,
        ),
        httpRequests: hosts.reduce(
          (sum, observed) =>
            sum +
            observed.ports.reduce(
              (n, port) => n + port.http.reduce((m, entry) => m + requestCount(entry), 0),
              0,
            ),
          0,
        ),
      },
      error: null,
    },
    hosts,
  };
}

/**
 * The worker results of one run: four workers take the jobs in order, each as soon as it is
 * free. In the second run the last job hits the scan window's deadline.
 */
export function buildDemoRun(run: DemoRun, jobs: readonly DemoJob[]): DemoJobResult[] {
  const ordered = jobs.toSorted((a, b) => a.sequence - b.sequence);
  const lastSequence = ordered.at(-1)?.sequence;
  const freeAt = Array.from({ length: WORKER_COUNT }, () => Date.parse(run.startedAt));

  return ordered.map((job) => {
    const worker = freeAt.indexOf(Math.min(...freeAt));
    const hitDeadline = run.number === 2 && job.sequence === lastSequence;
    const workerId = `nmap-worker-${worker + 1}`;
    const result = buildJobResult(run, job, workerId, freeAt[worker], hitDeadline);
    freeAt[worker] = Date.parse(result.scan.finishedAt) + 1500;
    return { job, workerId, hitDeadline, result };
  });
}
