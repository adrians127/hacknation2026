import type {
  HostDetail,
  HostHistoryEntry,
  HostListItem,
  ServiceDetail,
  ServiceSummary,
} from "@subsurf/contracts/hosts/hosts.schema";

import type { Prisma } from "~backend/generated/prisma/client";
import { decryptText } from "~backend/lib/crypto";
import { httpSummaries, openPortDetails } from "~backend/modules/results/details";

const NEWEST_SCAN_FIRST = { scan: { createdAt: "desc" } } as const;

/** Loads a host with its newest `up` observation and each service with its newest observation. */
export const HOST_INCLUDE = {
  // Only `up` observations carry a hostId, so this is the newest scan that saw the host up.
  observations: {
    orderBy: NEWEST_SCAN_FIRST,
    take: 1,
    select: { id: true, hostnames: { select: { name: true, source: true } } },
  },
  services: {
    orderBy: [{ protocol: "asc" }, { port: "asc" }],
    include: {
      observations: {
        orderBy: { hostObservation: NEWEST_SCAN_FIRST },
        take: 1,
        include: { hostObservation: { select: { observedAt: true } } },
      },
    },
  },
} as const satisfies Prisma.HostInclude;

export type HostRow = Prisma.HostGetPayload<{ include: typeof HOST_INCLUDE }>;
type ServiceRow = HostRow["services"][number];

/** The newest `up` or `down` answer for an address; `down` rows have no hostId, so keyed by IP. */
export interface ConclusiveObservation {
  status: "up" | "down";
  observedAt: Date | null;
}

interface HostContext {
  latestUpObservationId: string | null;
  isUp: boolean;
}

const HOSTNAME_SOURCE_ORDER = { job: 0, tls_san: 1, ptr: 2 } as const;

function hostnames(host: HostRow): string[] {
  const names = (host.observations[0]?.hostnames ?? []).toSorted(
    (a, b) =>
      HOSTNAME_SOURCE_ORDER[a.source] - HOSTNAME_SOURCE_ORDER[b.source] ||
      a.name.localeCompare(b.name),
  );
  return [...new Set(names.map((hostname) => hostname.name))];
}

function hostContext(host: HostRow, conclusive: ConclusiveObservation | undefined): HostContext {
  return {
    latestUpObservationId: host.observations[0]?.id ?? null,
    isUp: conclusive?.status === "up",
  };
}

function toServiceSummary(service: ServiceRow, context: HostContext): ServiceSummary {
  const latest = service.observations[0];
  return {
    id: service.id,
    protocol: service.protocol,
    port: service.port,
    observed: {
      name: latest?.serviceName ?? null,
      product: latest?.serviceProduct ?? null,
      version: latest?.serviceVersion ?? null,
    },
    overrides: {
      name: service.nameOverride,
      product: service.productOverride,
      version: service.versionOverride,
    },
    seenInLatestScan:
      context.isUp &&
      latest !== undefined &&
      latest.hostObservationId === context.latestUpObservationId,
    http: latest ? httpSummaries(latest.details) : [],
    firstSeenAt: service.firstSeenAt.toISOString(),
    lastSeenAt: service.lastSeenAt.toISOString(),
    triage: service.triage,
    tags: service.tags,
    note: decryptText(service.note),
  };
}

function toServiceDetail(service: ServiceRow, context: HostContext): ServiceDetail {
  const summary = toServiceSummary(service, context);
  const latest = service.observations[0];
  if (!latest) {
    return {
      ...summary,
      http: [],
      observedAt: null,
      reason: null,
      extraInfo: null,
      cpe: [],
      method: null,
      confidence: null,
      identity: { ttl: null, sshHostKeySha256: null, tlsCertSha256: null },
      banner: null,
      scripts: [],
    };
  }
  const details = openPortDetails(latest.details);
  return {
    ...summary,
    http: details.http,
    observedAt: latest.hostObservation.observedAt?.toISOString() ?? null,
    reason: latest.reason,
    extraInfo: latest.serviceExtraInfo,
    cpe: latest.serviceCpe,
    method: latest.serviceMethod,
    confidence: latest.serviceConfidence,
    identity: details.identity,
    banner: details.banner,
    scripts: details.scripts,
  };
}

function hostFields(host: HostRow, conclusive: ConclusiveObservation | undefined) {
  return {
    id: host.id,
    ip: host.ip,
    hostnames: hostnames(host),
    lastStatus: conclusive?.status ?? null,
    lastScannedAt: conclusive?.observedAt?.toISOString() ?? null,
    firstSeenAt: host.firstSeenAt.toISOString(),
    lastSeenAt: host.lastSeenAt.toISOString(),
    triage: host.triage,
    tags: host.tags,
    note: decryptText(host.note),
  };
}

export function toHostListItem(
  host: HostRow,
  conclusive: ConclusiveObservation | undefined,
): HostListItem {
  const context = hostContext(host, conclusive);
  return {
    ...hostFields(host, conclusive),
    services: host.services.map((service) => toServiceSummary(service, context)),
  };
}

export function toHostDetail(
  host: HostRow,
  conclusive: ConclusiveObservation | undefined,
  history: HostHistoryEntry[],
): HostDetail {
  const context = hostContext(host, conclusive);
  return {
    ...hostFields(host, conclusive),
    services: host.services.map((service) => toServiceDetail(service, context)),
    history,
  };
}
