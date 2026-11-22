import { randomUUID } from "node:crypto";

import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";
import type { ObservedHost } from "@subsurf/contracts/workers/worker-result.schema";

import { prisma } from "~backend/lib/prisma";
import { resultsService } from "~backend/modules/results/results.service";
import { createUser } from "~backend/test/auth";

let scansCreated = 0;

/**
 * Queues a one-job scan of 10.0.5.0/24 and ingests the example result
 * (docs/worker-result-format.md), changed by `edit`. Each scan is a minute newer than the last.
 */
export async function ingestScan(
  edit: (hosts: ObservedHost[]) => ObservedHost[] = (hosts) => hosts,
  workerId = "nmap-worker",
): Promise<string> {
  scansCreated += 1;
  const user = await createUser({ role: "admin" });
  const scan = await prisma.scan.create({
    data: {
      ports: "21-23,80,443,3306,8000-8100",
      maxRate: 100,
      batchSize: 256,
      targetCount: 1,
      addressCount: 256,
      jobCount: 1,
      requestedById: user.id,
      createdAt: new Date(Date.UTC(2026, 10, 20) + scansCreated * 60_000),
    },
  });
  const job = await prisma.scanJob.create({
    data: {
      scanId: scan.id,
      sequence: 1,
      subnet: "10.0.5.0/24",
      targets: ["10.0.5.0/24"],
      addressCount: 256,
    },
  });
  const result = buildWorkerResult({ scanId: scan.id, jobId: job.id, leaseId: randomUUID() });
  await resultsService.ingest({
    ...result,
    scan: {
      ...result.scan,
      worker: {
        ...result.scan.worker,
        id: workerId,
        nmapVersion: workerId === "nmap-worker" ? result.scan.worker.nmapVersion : null,
      },
    },
    hosts: edit(result.hosts),
  });
  return scan.id;
}

/** The example's `up` host, moved to another address with only a MySQL port. */
export function databaseHost(hosts: readonly ObservedHost[]): ObservedHost {
  const [wiki] = hosts;
  const [ssh] = wiki.ports;
  if (!ssh.service) throw new Error("The example's SSH port has a service");
  return {
    ...wiki,
    ip: "10.0.5.20",
    hostnames: [{ name: "db01.example.org", source: "ptr" }],
    ports: [
      {
        ...ssh,
        port: 3306,
        service: { ...ssh.service, name: "mysql", product: "MySQL", version: "8.0.36" },
        banner: null,
      },
    ],
  };
}

export async function hostIdOf(ip: string): Promise<string> {
  return (await prisma.host.findUniqueOrThrow({ where: { ip } })).id;
}

export async function serviceIdOf(ip: string, port: number): Promise<string> {
  const host = await prisma.host.findUniqueOrThrow({ where: { ip }, include: { services: true } });
  const service = host.services.find((candidate) => candidate.port === port);
  if (!service) throw new Error(`No service ${ip}:${port}`);
  return service.id;
}
