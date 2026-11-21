import { env } from "~backend/config/env";
import { prisma } from "~backend/lib/prisma";
import { createNvdSource } from "~backend/modules/vulnerabilities/sources/nvd/nvd.source";
import { createOsvSource } from "~backend/modules/vulnerabilities/sources/osv/osv.source";
import type { VulnerabilitySource } from "~backend/modules/vulnerabilities/sources/source";

/**
 * Every source the module knows. Adding one: implement `VulnerabilitySource` and add its factory
 * here; `VULN_SOURCES` picks which run. The order is also the preference when two sources describe
 * the same CVE (title, severity).
 */
const FACTORIES: Record<string, () => VulnerabilitySource> = {
  nvd: createNvdSource,
  osv: createOsvSource,
};

let configured: VulnerabilitySource[] | undefined;

/** The sources named in `VULN_SOURCES`, in registry order. */
export function configuredSources(): VulnerabilitySource[] {
  if (!configured) {
    const wanted = new Set(env.VULN_SOURCES.split(","));
    const unknown = [...wanted].filter((id) => !(id in FACTORIES));
    if (unknown.length > 0) throw new Error(`Unknown VULN_SOURCES: ${unknown.join(", ")}`);
    configured = Object.entries(FACTORIES)
      .filter(([id]) => wanted.has(id))
      .map(([, create]) => create());
  }
  return configured;
}

export function sourceById(id: string): VulnerabilitySource | undefined {
  return configuredSources().find((source) => source.id === id);
}

export const sourceOrder = (): string[] => configuredSources().map((source) => source.id);

/** A `VulnerabilitySource` row per configured source (enabled by default). */
export async function ensureSources(): Promise<void> {
  await prisma.vulnerabilitySource.createMany({
    data: configuredSources().map((source) => ({ id: source.id })),
    skipDuplicates: true,
  });
}
