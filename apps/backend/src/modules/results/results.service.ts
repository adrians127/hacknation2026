import { ipv4ToInt } from "@subsurf/contracts/targets/ipv4";
import type {
  HostStatus,
  ObservedHost,
  WorkerResult,
} from "@subsurf/contracts/workers/worker-result.schema";

import {
  Prisma,
  type HostnameSource,
  type ScanStopReason,
} from "~backend/generated/prisma/client";
import { HttpError } from "~backend/lib/http-error";
import { isUniqueViolation, prisma } from "~backend/lib/prisma";
import { hostsService } from "~backend/modules/hosts/hosts.service";
import { sealPortDetails } from "~backend/modules/results/details";
import { portFingerprint } from "~backend/modules/results/fingerprint";
import { addressesOutsideJob, portsOutsideSpec } from "~backend/modules/results/job-scope";

export type IngestOutcome =
  | { status: "ingested"; resultId: string; hostsWritten: number; hostsKept: number }
  | { status: "duplicate"; resultId: string };

// One result holds at most 1024 hosts; nested writes for the `up` ones take a while.
const TRANSACTION_TIMEOUT_MS = 60_000;
const MAX_REPORTED_OFFENDERS = 10;

const STOP_REASONS = {
  deadline: "deadline",
  "stop-requested": "stop_requested",
  "lease-lost": "lease_lost",
  error: "error",
} as const satisfies Record<NonNullable<WorkerResult["scan"]["stopReason"]>, ScanStopReason>;

const HOSTNAME_SOURCES = {
  job: "job",
  ptr: "ptr",
  "tls-san": "tls_san",
} as const satisfies Record<ObservedHost["hostnames"][number]["source"], HostnameSource>;

/** `up` and `down` are answers; the other statuses only say the address went unscanned. */
function isConclusive(status: HostStatus): boolean {
  return status === "up" || status === "down";
}

/** A retry may rescan an address: a conclusive answer is never replaced by an inconclusive one. */
function shouldReplace(existing: HostStatus, incoming: HostStatus): boolean {
  return isConclusive(incoming) || !isConclusive(existing);
}

const jsonOrDbNull = <T extends Prisma.InputJsonValue>(value: T | null) => value ?? Prisma.DbNull;

function uniqueHostnames(host: ObservedHost) {
  const seen = new Set<string>();
  return host.hostnames.flatMap(({ name, source }) => {
    const key = `${source} ${name}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ name, source: HOSTNAME_SOURCES[source] }];
  });
}

function hostObservationRow(scanId: string, resultId: string, host: ObservedHost) {
  return {
    scanId,
    resultId,
    ip: host.ip,
    ipNumber: BigInt(ipv4ToInt(host.ip)),
    status: host.status,
    reason: host.reason,
    observedAt: host.observedAt === null ? null : new Date(host.observedAt),
    latencyMs: host.latencyMs,
    error: jsonOrDbNull(host.error),
  };
}

async function assertWithinJob(tx: Prisma.TransactionClient, result: WorkerResult): Promise<void> {
  const job = await tx.scanJob.findUnique({
    where: { id: result.scan.jobId },
    select: { scanId: true, targets: true, scan: { select: { ports: true } } },
  });
  if (!job) {
    throw HttpError.notFound("Scan job not found");
  }
  if (job.scanId !== result.scan.scanId) {
    throw HttpError.badRequest("scan.scanId does not match the job's scan");
  }

  const strayAddresses = addressesOutsideJob(
    job.targets,
    result.hosts.map((host) => host.ip),
  );
  if (strayAddresses.length > 0) {
    const sample = strayAddresses.slice(0, MAX_REPORTED_OFFENDERS).join(", ");
    throw HttpError.badRequest(`Addresses outside the job: ${sample}`);
  }
  const strayPorts = portsOutsideSpec(
    job.scan.ports,
    result.hosts.flatMap((host) => host.ports.map((port) => port.port)),
  );
  if (strayPorts.length > 0) {
    const sample = [...new Set(strayPorts)].slice(0, MAX_REPORTED_OFFENDERS).join(", ");
    throw HttpError.badRequest(`Ports outside the scan's port list: ${sample}`);
  }
}

async function writeUpHost(
  tx: Prisma.TransactionClient,
  scanId: string,
  resultId: string,
  host: ObservedHost,
  seenAt: Date,
): Promise<void> {
  const hostId = await hostsService.recordHostUp(tx, host.ip, seenAt);
  const ports: Prisma.PortObservationCreateManyHostObservationInput[] = [];
  for (const port of host.ports) {
    const serviceId = await hostsService.recordServiceOpen(
      tx,
      hostId,
      port.protocol,
      port.port,
      seenAt,
    );
    ports.push({
      serviceId,
      protocol: port.protocol,
      port: port.port,
      state: port.state,
      reason: port.reason,
      serviceName: port.service?.name ?? null,
      serviceProduct: port.service?.product ?? null,
      serviceVersion: port.service?.version ?? null,
      serviceExtraInfo: port.service?.extraInfo ?? null,
      serviceCpe: port.service?.cpe ?? [],
      serviceMethod: port.service?.method ?? null,
      serviceConfidence: port.service?.confidence ?? null,
      fingerprint: portFingerprint(port),
      details: sealPortDetails(port),
    });
  }

  await tx.hostObservation.create({
    data: {
      ...hostObservationRow(scanId, resultId, host),
      hostId,
      hostnames: { createMany: { data: uniqueHostnames(host) } },
      ports: { createMany: { data: ports } },
    },
  });
}

async function ingestInTransaction(
  tx: Prisma.TransactionClient,
  result: WorkerResult,
): Promise<IngestOutcome> {
  const { scan } = result;
  await assertWithinJob(tx, result);

  const stored = await tx.scanJobResult.create({
    data: {
      scanId: scan.scanId,
      scanJobId: scan.jobId,
      leaseId: scan.leaseId,
      workerId: scan.worker.id,
      workerVersion: scan.worker.version,
      nmapVersion: scan.worker.nmapVersion,
      status: scan.status,
      stopReason: scan.stopReason === null ? null : STOP_REASONS[scan.stopReason],
      startedAt: new Date(scan.startedAt),
      finishedAt: new Date(scan.finishedAt),
      durationMs: scan.durationMs,
      phasesMs: scan.phasesMs,
      params: scan.params,
      counts: scan.counts,
      error: jsonOrDbNull(scan.error),
    },
    select: { id: true },
  });

  const existing = await tx.hostObservation.findMany({
    where: { scanId: scan.scanId, ip: { in: result.hosts.map((host) => host.ip) } },
    select: { id: true, ip: true, status: true },
  });
  const existingByIp = new Map(existing.map((row) => [row.ip, row]));
  const toWrite = result.hosts.filter((host) => {
    const previous = existingByIp.get(host.ip);
    return !previous || shouldReplace(previous.status, host.status);
  });
  const replacedIds = toWrite.flatMap((host) => existingByIp.get(host.ip)?.id ?? []);
  if (replacedIds.length > 0) {
    await tx.hostObservation.deleteMany({ where: { id: { in: replacedIds } } });
  }

  const upHosts = toWrite.filter((host) => host.status === "up");
  const otherHosts = toWrite.filter((host) => host.status !== "up");
  if (otherHosts.length > 0) {
    await tx.hostObservation.createMany({
      data: otherHosts.map((host) => hostObservationRow(scan.scanId, stored.id, host)),
    });
  }
  const finishedAt = new Date(scan.finishedAt);
  for (const host of upHosts) {
    const seenAt = host.observedAt === null ? finishedAt : new Date(host.observedAt);
    await writeUpHost(tx, scan.scanId, stored.id, host, seenAt);
  }

  return {
    status: "ingested",
    resultId: stored.id,
    hostsWritten: toWrite.length,
    hostsKept: result.hosts.length - toWrite.length,
  };
}

async function findByLease(leaseId: string): Promise<IngestOutcome | null> {
  const stored = await prisma.scanJobResult.findUnique({ where: { leaseId }, select: { id: true } });
  return stored ? { status: "duplicate", resultId: stored.id } : null;
}

/**
 * Turns a validated worker result (docs/worker-result-format.md) into observation rows and
 * Host/Service assets, in one transaction. A result resent under the same lease is a no-op.
 */
export const resultsService = {
  async ingest(result: WorkerResult): Promise<IngestOutcome> {
    const duplicate = await findByLease(result.scan.leaseId);
    if (duplicate) return duplicate;

    try {
      return await prisma.$transaction((tx) => ingestInTransaction(tx, result), {
        timeout: TRANSACTION_TIMEOUT_MS,
      });
    } catch (error) {
      // Two copies of one result raced past the check above.
      if (isUniqueViolation(error)) {
        const raced = await findByLease(result.scan.leaseId);
        if (raced) return raced;
      }
      throw error;
    }
  },
};
