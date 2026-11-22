import { describe, expect, it } from "vitest";

import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";

import { prisma } from "~backend/lib/prisma";
import { portFingerprint } from "~backend/modules/results/fingerprint";
import { refingerprintPorts } from "~backend/modules/results/refingerprint";
import { ingestScan } from "~backend/test/scans";

describe("refingerprintPorts", () => {
  it("recomputes stale fingerprints from the stored ports, and only those", async () => {
    await ingestScan();
    await prisma.portObservation.updateMany({ where: { port: 443 }, data: { fingerprint: "stale" } });

    expect(await refingerprintPorts(prisma)).toEqual({ checked: 2, updated: 1 });
    const https = await prisma.portObservation.findFirstOrThrow({ where: { port: 443 } });
    expect(https.fingerprint).toBe(portFingerprint(buildWorkerResult().hosts[0].ports[1]));
    expect(await refingerprintPorts(prisma)).toEqual({ checked: 2, updated: 0 });
  });
});
