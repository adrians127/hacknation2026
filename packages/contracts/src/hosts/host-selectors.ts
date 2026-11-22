import { z } from "zod";

import { cidrToRange, formatCidr, ipv4ToInt, mergeRanges, parseCidr, type Ipv4Range } from "../targets/ipv4";

// Not the target-input parser: that one rejects prefixes under /16 and reserved ranges, which
// only matter for what gets scanned, not for matching hosts already in the database.

export const HOST_SELECTORS_MAX = 1000;

/** One IPv4 address or CIDR block picking hosts of a scan. */
export const HostSelectorSchema = z.union([z.ipv4(), z.cidrv4()]);

const isIpv4 = (value: string) => z.ipv4().safeParse(value).success;
const isCidr = (value: string) => z.cidrv4().safeParse(value).success;

export interface ParsedHostSelectors {
  /** Unique, with CIDR host bits cleared (`10.0.5.7/24` → `10.0.5.0/24`). */
  selectors: string[];
  invalid: string[];
}

/** Addresses and CIDRs separated by commas, semicolons, spaces or new lines. */
export function parseHostSelectors(text: string): ParsedHostSelectors {
  const selectors = new Set<string>();
  const invalid = new Set<string>();
  for (const token of text.split(/[\s,;]+/)) {
    if (!token) continue;
    if (isIpv4(token)) selectors.add(token);
    else if (isCidr(token)) selectors.add(formatCidr(parseCidr(token)));
    else invalid.add(token);
  }
  return { selectors: [...selectors], invalid: [...invalid] };
}

/** Expects selectors validated with `HostSelectorSchema`. Sorted and merged. */
export function selectorRanges(selectors: readonly string[]): Ipv4Range[] {
  return mergeRanges(
    selectors.map((selector) => {
      if (selector.includes("/")) return cidrToRange(parseCidr(selector));
      const address = ipv4ToInt(selector);
      return { start: address, end: address };
    }),
  );
}
