import { compareApk } from "~backend/modules/vulnerabilities/versioning/apk";
import { compareDpkg } from "~backend/modules/vulnerabilities/versioning/dpkg";
import { compareGeneric } from "~backend/modules/vulnerabilities/versioning/generic";
import { compareMaven } from "~backend/modules/vulnerabilities/versioning/maven";
import { compareSemver } from "~backend/modules/vulnerabilities/versioning/semver";

export type VersionComparator = (left: string, right: string) => number;

// PyPI (PEP 440) and Packagist versions order well enough with the generic rules.
const BY_ECOSYSTEM: Record<string, VersionComparator> = {
  Debian: compareDpkg,
  Ubuntu: compareDpkg,
  Alpine: compareApk,
  Maven: compareMaven,
  npm: compareSemver,
  Go: compareSemver,
};

/** How an OSV range of `type` orders versions in `ecosystem` (OSV schema: SEMVER | ECOSYSTEM). */
export function comparatorFor(ecosystem: string, rangeType: string): VersionComparator {
  if (rangeType === "SEMVER") return compareSemver;
  return BY_ECOSYSTEM[ecosystem] ?? compareGeneric;
}

export { compareGeneric };
