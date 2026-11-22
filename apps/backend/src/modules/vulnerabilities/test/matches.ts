import { randomUUID } from "node:crypto";

import { prisma } from "~backend/lib/prisma";

/** A host with one service and an active match, written directly (no scan needed). */
export async function serviceWithMatch(canonicalId = "CVE-2024-6387") {
  const now = new Date();
  const host = await prisma.host.create({
    data: {
      ip: `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
      ipNumber: BigInt(Math.floor(Math.random() * 2 ** 31)),
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });
  const service = await prisma.service.create({
    data: { hostId: host.id, protocol: "tcp", port: 22, firstSeenAt: now, lastSeenAt: now },
  });
  await prisma.vulnerabilityMatch.create({
    data: {
      serviceId: service.id,
      canonicalId,
      confidence: "confirmed",
      evidence: [],
      vulnerabilityId: randomUUID(),
      severity: "high",
      basis: {},
      basisHash: "x",
    },
  });
  return { hostId: host.id, serviceId: service.id, canonicalId };
}
