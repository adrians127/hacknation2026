import type {
  ScanChange,
  ScanChangeCounts,
  ScanChangeFilter,
} from "@subsurf/contracts/scans/scan-results.schema";

import type { HostObservationStatus, TransportProtocol } from "~backend/generated/prisma/client";

/** What the diff needs from a HostObservation: no details, so a whole /16 stays cheap. */
export interface ObservedPorts {
  ip: string;
  ipNumber: bigint;
  status: HostObservationStatus;
  hostId: string | null;
  ports: readonly { serviceId: string; protocol: TransportProtocol; port: number; fingerprint: string }[];
}

export interface ServiceDiff {
  serviceId: string;
  protocol: TransportProtocol;
  port: number;
  change: ScanChange | null;
  /** Which scan's observation describes it: the base scan's for a service that is gone. */
  observedIn: "current" | "base";
}

export interface HostDiff {
  ip: string;
  ipNumber: bigint;
  hostId: string;
  change: ScanChange | null;
  services: ServiceDiff[];
}

const keyOf = (port: { protocol: string; port: number }) => `${port.protocol}/${port.port}`;
const byPort = (a: ServiceDiff, b: ServiceDiff) => a.port - b.port;

function upHost(
  host: ObservedPorts,
  hostId: string,
  before: ObservedPorts | undefined,
  compared: boolean,
): HostDiff {
  const base = { ip: host.ip, ipNumber: host.ipNumber, hostId };
  if (!compared || !before) {
    const change: ScanChange | null = compared ? "new" : null;
    const services = host.ports.map(
      (port): ServiceDiff => ({ ...port, change, observedIn: "current" }),
    );
    return { ...base, change, services: services.toSorted(byPort) };
  }

  const earlier = new Map(before.ports.map((port) => [keyOf(port), port]));
  const now = new Set(host.ports.map(keyOf));
  const services: ServiceDiff[] = [
    ...host.ports.map((port) => {
      const previous = earlier.get(keyOf(port));
      const change: ScanChange = !previous
        ? "new"
        : previous.fingerprint === port.fingerprint
          ? "unchanged"
          : "changed";
      return { ...port, change, observedIn: "current" as const };
    }),
    ...before.ports
      .filter((port) => !now.has(keyOf(port)))
      .map((port) => ({ ...port, change: "gone" as const, observedIn: "base" as const })),
  ].toSorted(byPort);
  const changed = services.some((service) => service.change !== "unchanged");
  return { ...base, change: changed ? "changed" : "unchanged", services };
}

/**
 * Compares a scan with its base scan (docs/worker-result-format.md, "What the backend derives").
 * - `current`: this scan's `up` observations, plus its observations of the base scan's up hosts.
 * - `base`: the base scan's `up` observations; `null` when there is no base scan (no changes).
 * Only conclusive answers count: an address that timed out is `unknown`, never `gone`, and an
 * address outside this scan's coverage is left out.
 */
export function diffScan(
  current: readonly ObservedPorts[],
  base: readonly ObservedPorts[] | null,
): HostDiff[] {
  const upBefore = new Map(
    (base ?? []).filter((host) => host.status === "up").map((host) => [host.ip, host]),
  );
  const entries: HostDiff[] = [];
  for (const host of current) {
    const before = upBefore.get(host.ip);
    if (host.status === "up" && host.hostId) {
      entries.push(upHost(host, host.hostId, before, base !== null));
    } else if (host.status !== "up" && before?.hostId) {
      const change: ScanChange = host.status === "down" ? "gone" : "unknown";
      entries.push({
        ip: host.ip,
        ipNumber: host.ipNumber,
        hostId: before.hostId,
        change,
        services: before.ports
          .map((port) => ({ ...port, change, observedIn: "base" as const }))
          .toSorted(byPort),
      });
    }
  }
  return entries.toSorted((a, b) =>
    a.ipNumber < b.ipNumber ? -1 : a.ipNumber > b.ipNumber ? 1 : 0,
  );
}

export function matchesChange(change: ScanChange | null, filter: ScanChangeFilter): boolean {
  if (filter === "any") return change === "new" || change === "gone" || change === "changed";
  return change === filter;
}

export function countChanges(entries: readonly HostDiff[]): ScanChangeCounts {
  const counts: ScanChangeCounts = {
    hosts: { new: 0, gone: 0, changed: 0, unknown: 0 },
    services: { new: 0, gone: 0, changed: 0 },
  };
  for (const entry of entries) {
    if (entry.change === null || entry.change === "unchanged") continue;
    counts.hosts[entry.change] += 1;
    // An unknown host's services are not known to be gone.
    if (entry.change === "unknown") continue;
    for (const service of entry.services) {
      if (service.change === "new" || service.change === "gone" || service.change === "changed") {
        counts.services[service.change] += 1;
      }
    }
  }
  return counts;
}
