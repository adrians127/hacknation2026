import { Resolver } from "node:dns/promises";

import { ipv4ToInt, overlapsReserved } from "@hacknation/contracts/targets/ipv4";
import type {
  ImportWarning,
  ImportWarningCode,
} from "@hacknation/contracts/targets/targets.schema";

const CONCURRENCY = 50;
const TIMEOUT_MS = 2000;
const TRIES = 2;

export interface ResolvedDomain {
  domain: string;
  addresses: string[];
}

export interface DnsResolution {
  resolved: ResolvedDomain[];
  warnings: ImportWarning[];
}

const WARNING_BY_ERROR: Record<string, ImportWarningCode> = {
  ENOTFOUND: "dns_not_found",
  ENODATA: "dns_no_addresses",
  ETIMEOUT: "dns_timeout",
};

function warningFor(error: unknown): ImportWarningCode {
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  return (typeof code === "string" && WARNING_BY_ERROR[code]) || "dns_failed";
}

async function forEachConcurrently<T>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * A records of every domain, minus reserved addresses (a name pointing at 127.0.0.1 must not
 * turn into a scan of it). Failures become warnings: the domain is just left out of the scan.
 */
export async function resolveDomains(domains: readonly string[]): Promise<DnsResolution> {
  const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: TRIES });
  const resolved: ResolvedDomain[] = [];
  const warnings: ImportWarning[] = [];

  await forEachConcurrently(domains, CONCURRENCY, async (domain) => {
    try {
      const all = await resolver.resolve4(domain);
      const addresses = all.filter((ip) => {
        const address = ipv4ToInt(ip);
        return !overlapsReserved({ start: address, end: address });
      });
      if (addresses.length < all.length) warnings.push({ code: "resolves_to_reserved", value: domain });
      if (addresses.length > 0) resolved.push({ domain, addresses });
    } catch (error) {
      warnings.push({ code: warningFor(error), value: domain });
    }
  });

  // Lookups finish in any order; keep the output stable.
  return {
    resolved: resolved.toSorted((a, b) => a.domain.localeCompare(b.domain)),
    warnings: warnings.toSorted((a, b) => a.value.localeCompare(b.value) || a.code.localeCompare(b.code)),
  };
}
