// Recomputes stored port fingerprints after the compared fields change (`pnpm db:refingerprint`).
import { prisma } from "~backend/lib/prisma";
import { refingerprintPorts } from "~backend/modules/results/refingerprint";

try {
  const { checked, updated } = await refingerprintPorts(prisma);
  console.log(`Port fingerprints: ${updated} of ${checked} updated`);
} finally {
  await prisma.$disconnect();
}
