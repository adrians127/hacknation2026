import { createHash } from "node:crypto";

import type { OpenPort } from "@subsurf/contracts/workers/worker-result.schema";

import { comparablePort, hashedView } from "~backend/modules/results/comparable";

/** SHA-256 over what makes a port "changed" between two scans (`comparable.ts`). */
export function portFingerprint(port: OpenPort): string {
  return createHash("sha256").update(JSON.stringify(hashedView(comparablePort(port)))).digest("hex");
}
