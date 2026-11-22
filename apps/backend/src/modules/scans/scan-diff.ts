import type {
  ScanChange,
  ScanChangeCounts,
  ScanChangeFilter,
  ScanCoverage,
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
  /** The base scan's answer for the address; `null` when it did not cover it or there is none. */
  baseStatus: HostObservationStatus | null;
  services: ServiceDiff[];
}

const keyOf = (port: { protocol: string; port: number }) => `${port.protocol}/${port.port}`;
const byPort = (a: ServiceDiff, b: ServiceDiff) => a.port - b.port;

const isConclusive = (status: HostObservationStatus) => status === "up" || status === "down";

/** Up now, compared with what the base scan got: `before` is `undefined` outside its coverage. */
function upHost(
  host: ObservedPorts,
  hostId: string,
  before: ObservedPorts | undefined,
  compared: boolean,
): HostDiff {
  const base = { ip: host.ip, ipNumber: host.ipNumber, hostId, baseStatus: before?.status ?? null };
  if (!compared || before?.status !== "up") {
    // Only a conclusive `down` makes it new: no answer, or no scan of it, says nothing.
    const change: ScanChange | null = !compared
      ? null
      : before?.status === "down"
        ? "new"
        : "unknown";
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
 * - `base`: the base scan's observations of those addresses, any status; `null` when there is
 *   no base scan (no changes).
 * Only conclusive answers count: an address either scan got no answer for, or the base scan did
 * not cover, is `unknown`, never `new` or `gone`. A base host outside this scan's coverage is
 * left out.
 */
export function diffScan(
  current: readonly ObservedPorts[],
  base: readonly ObservedPorts[] | null,
): HostDiff[] {
  const before = new Map((base ?? []).map((host) => [host.ip, host]));
  const entries: HostDiff[] = [];
  for (const host of current) {
    const earlier = before.get(host.ip);
    if (host.status === "up" && host.hostId) {
      entries.push(upHost(host, host.hostId, earlier, base !== null));
    } else if (host.status !== "up" && earlier?.status === "up" && earlier.hostId) {
      const change: ScanChange = host.status === "down" ? "gone" : "unknown";
      entries.push({
        ip: host.ip,
        ipNumber: host.ipNumber,
        hostId: earlier.hostId,
        change,
        baseStatus: "up",
        services: earlier.ports
          .map((port) => ({ ...port, change, observedIn: "base" as const }))
          .toSorted(byPort),
      });
    }
  }
  return entries.toSorted((a, b) =>
    a.ipNumber < b.ipNumber ? -1 : a.ipNumber > b.ipNumber ? 1 : 0,
  );
}

/** Addresses with a conclusive answer in both scans, or only in one of them. */
export function countCoverage(
  current: readonly Pick<ObservedPorts, "ip" | "status">[],
  base: readonly Pick<ObservedPorts, "ip" | "status">[],
): ScanCoverage {
  const answeredBefore = new Set(
    base.filter((host) => isConclusive(host.status)).map((host) => host.ip),
  );
  let both = 0;
  let onlyCurrent = 0;
  for (const host of current) {
    if (!isConclusive(host.status)) continue;
    if (answeredBefore.has(host.ip)) both += 1;
    else onlyCurrent += 1;
  }
  return { both, onlyBase: answeredBefore.size - both, onlyCurrent };
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
