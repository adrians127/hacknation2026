import { createHash } from "node:crypto";

import { Prisma } from "~backend/generated/prisma/client";
import { prisma } from "~backend/lib/prisma";
import {
  componentsOf,
  type Component,
} from "~backend/modules/vulnerabilities/components/component";
import {
  NO_DISTRO,
  type DistroHint,
} from "~backend/modules/vulnerabilities/components/distro-hint";

/** A service as its newest observation describes it: what its matches are evaluated on. */
export interface ServiceSubject {
  serviceId: string;
  scanId: string;
  cpe: string[];
  version: string | null;
  extraInfo: string | null;
  components: Component[];
  distro: DistroHint;
  /** Changes when the scanner reports other software: tells `service_changed` retractions apart. */
  basisHash: string;
}

interface IdentityRow {
  serviceId: string;
  scanId: string;
  cpe: string[];
  version: string | null;
  extraInfo: string | null;
}

export function basisHashOf(identity: Pick<IdentityRow, "cpe" | "version" | "extraInfo">) {
  return createHash("sha256")
    .update(JSON.stringify([identity.cpe.toSorted(), identity.version, identity.extraInfo]))
    .digest("hex");
}

function toSubject(row: IdentityRow): ServiceSubject {
  const components = componentsOf(row);
  return {
    ...row,
    components,
    distro: components[0]?.distro ?? NO_DISTRO,
    basisHash: basisHashOf(row),
  };
}

/**
 * The newest observation of each service: by scan creation, then observation time (results arrive
 * out of order and retries replace observations, so there is no "last written" to rely on).
 */
async function newestIdentities(where: Prisma.Sql, limit: number | null): Promise<IdentityRow[]> {
  return prisma.$queryRaw<IdentityRow[]>`
    SELECT DISTINCT ON (po."serviceId")
      po."serviceId", ho."scanId", po."serviceCpe" AS "cpe", po."serviceVersion" AS "version",
      po."serviceExtraInfo" AS "extraInfo"
    FROM "PortObservation" po
    JOIN "HostObservation" ho ON ho.id = po."hostObservationId"
    JOIN "Scan" s ON s.id = ho."scanId"
    WHERE ${where}
    ORDER BY po."serviceId", s."createdAt" DESC, ho."observedAt" DESC NULLS LAST
    ${limit === null ? Prisma.empty : Prisma.sql`LIMIT ${limit}`}`;
}

export async function subjectsOf(serviceIds: readonly string[]): Promise<ServiceSubject[]> {
  if (serviceIds.length === 0) return [];
  const rows = await newestIdentities(
    Prisma.sql`po."serviceId" = ANY(${[...serviceIds]}::uuid[])`,
    null,
  );
  return rows.map(toSubject);
}

/** Every observed service, in id order, `size` at a time. */
export async function* allSubjects(size: number): AsyncGenerator<ServiceSubject[]> {
  let after: string | null = null;
  for (;;) {
    const where: Prisma.Sql =
      after === null ? Prisma.sql`TRUE` : Prisma.sql`po."serviceId" > ${after}::uuid`;
    const rows = await newestIdentities(where, size);
    if (rows.length === 0) return;
    yield rows.map(toSubject);
    after = rows.at(-1)?.serviceId ?? null;
    if (rows.length < size) return;
  }
}
