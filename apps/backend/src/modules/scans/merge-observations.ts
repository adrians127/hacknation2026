import type { Prisma } from "~backend/generated/prisma/client";
import { portFingerprint } from "~backend/modules/results/fingerprint";
import { storedOpenPort } from "~backend/modules/results/details";
import type { ObservationRow } from "~backend/modules/scans/scan-results.mapper";

type PortRow = ObservationRow["ports"][number];

const hostKey = (row: Pick<ObservationRow, "scanId" | "ip">) => `${row.scanId}/${row.ip}`;
const portKey = (row: Pick<PortRow, "protocol" | "port">) => `${row.protocol}/${row.port}`;

function workerRank(worker: string): number {
  if (worker.startsWith("nmap")) return 3;
  if (worker.startsWith("httpx")) return 2;
  if (worker.startsWith("tlsx")) return 2;
  if (worker.startsWith("masscan")) return 1;
  return 0;
}

function httpEndpoints(port: PortRow): Prisma.JsonObject[] {
  const details = port.details;
  if (details === null || Array.isArray(details) || typeof details !== "object") return [];
  const http = details.http;
  return Array.isArray(http)
    ? http.filter((entry): entry is Prisma.JsonObject =>
        entry !== null && !Array.isArray(entry) && typeof entry === "object",
      )
    : [];
}

function tlsObservations(port: PortRow): Prisma.JsonObject[] {
  const details = port.details;
  if (details === null || Array.isArray(details) || typeof details !== "object") return [];
  return Array.isArray(details.tls)
    ? details.tls.filter((entry): entry is Prisma.JsonObject =>
        entry !== null && !Array.isArray(entry) && typeof entry === "object",
      )
    : [];
}

function endpointKey(endpoint: Prisma.JsonObject): string {
  const scheme = typeof endpoint.scheme === "string" ? endpoint.scheme : "";
  const vhost = typeof endpoint.vhost === "string" ? endpoint.vhost : "";
  return `${scheme} ${vhost}`;
}

function mergePorts(rows: readonly ObservationRow[]): PortRow[] {
  const byPort = new Map<string, { worker: string; port: PortRow }[]>();
  for (const row of rows) {
    for (const port of row.ports) {
      const key = portKey(port);
      byPort.set(key, [...(byPort.get(key) ?? []), { worker: row.result.workerId, port }]);
    }
  }
  return [...byPort.values()]
    .map((candidates) => {
      // The service, banner and scripts come from the best service detector.
      const ranked = candidates.toSorted((a, b) => workerRank(a.worker) - workerRank(b.worker));
      const base = ranked.at(-1)!.port;
      if (ranked.length === 1) return base;

      // HTTP data comes from the HTTP worker when two sources observed the same endpoint.
      const endpoints = new Map<string, Prisma.JsonObject>();
      for (const candidate of ranked.toSorted((a, b) =>
        Number(a.worker.startsWith("httpx")) - Number(b.worker.startsWith("httpx")),
      )) {
        for (const endpoint of httpEndpoints(candidate.port)) {
          endpoints.set(endpointKey(endpoint), endpoint);
        }
      }
      const tls = new Map<string, Prisma.JsonObject>();
      for (const candidate of ranked.toSorted((a, b) =>
        Number(a.worker.startsWith("tlsx")) - Number(b.worker.startsWith("tlsx")),
      )) {
        for (const observation of tlsObservations(candidate.port)) {
          tls.set(typeof observation.vhost === "string" ? observation.vhost : "", observation);
        }
      }
      const details = base.details;
      if (details === null || Array.isArray(details) || typeof details !== "object") return base;
      const merged: PortRow = {
        ...base,
        details: {
          ...details,
          http: [...endpoints.values()].toSorted((a, b) => endpointKey(a).localeCompare(endpointKey(b))),
          tls: [...tls.entries()].toSorted(([a], [b]) => a.localeCompare(b)).map(([, value]) => value),
        },
      };
      return { ...merged, fingerprint: portFingerprint(storedOpenPort(merged)) };
    })
    .toSorted((a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol));
}

/** Builds a read-only view; the stored observations and their result IDs stay untouched. */
export function mergeObservations(
  selected: readonly ObservationRow[],
  byStage: readonly ObservationRow[],
): ObservationRow[] {
  const stages = new Map<string, ObservationRow[]>();
  for (const row of byStage) {
    const key = hostKey(row);
    stages.set(key, [...(stages.get(key) ?? []), row]);
  }
  return selected.map((primary) => {
    if (primary.status !== "up") return primary;
    const rows = stages.get(hostKey(primary))?.filter((row) => row.status === "up") ?? [];
    if (!rows.some((row) => row.id === primary.id)) rows.push(primary);
    if (rows.length === 1) return primary;
    const hostnames = new Map<string, ObservationRow["hostnames"][number]>();
    for (const row of rows) {
      for (const name of row.hostnames) hostnames.set(`${name.source}/${name.name}`, name);
    }
    return { ...primary, hostnames: [...hostnames.values()], ports: mergePorts(rows) };
  });
}
