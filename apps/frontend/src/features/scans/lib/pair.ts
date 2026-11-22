import type { Scan } from "@subsurf/contracts/scans/scans.schema";

/** A scan that answered for at least one address: something to compare. */
export const hasResults = (scan: Scan) => scan.hosts.up + scan.hosts.down > 0;

export const scanDate = (scan: Pick<Scan, "startedAt" | "createdAt">) => scan.startedAt ?? scan.createdAt;

/** Orders two scans as (older, newer): "before" is always the base scan. */
export function orderPair(scans: readonly Scan[], first: string, second: string): [string, string] {
  const createdAt = (id: string) => scans.find((scan) => scan.id === id)?.createdAt ?? "";
  return createdAt(first) <= createdAt(second) ? [first, second] : [second, first];
}

export const compareUrl = (pair: { base?: string | null; target: string; host?: string }) => {
  const params = new URLSearchParams();
  if (pair.base) params.set("base", pair.base);
  params.set("target", pair.target);
  if (pair.host) params.set("host", pair.host);
  return `/app/scans/compare?${params}`;
};
