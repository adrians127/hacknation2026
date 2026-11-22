const CVE = /CVE-\d{4}-\d{4,}/;
const EXACT_CVE = /^CVE-\d{4}-\d{4,}$/;

/**
 * The id that merges records of different sources: the CVE in the record's own id
 * (`DEBIAN-CVE-2023-48795`), else the only CVE among its aliases (OSV Debian records list it under
 * `upstream`), else the record's own id.
 */
export function canonicalIdOf(externalId: string, related: readonly string[] = []): string {
  const own = CVE.exec(externalId)?.[0];
  if (own) return own;
  const cves = [...new Set(related.filter((id) => EXACT_CVE.test(id)))];
  return cves.length === 1 ? cves[0] : externalId;
}
