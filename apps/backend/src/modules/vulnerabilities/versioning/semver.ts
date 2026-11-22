import { compareGeneric } from "~backend/modules/vulnerabilities/versioning/generic";

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** SemVer 2.0.0 precedence (npm, Go). Anything that is not strict SemVer falls back to generic. */
export function compareSemver(left: string, right: string): number {
  const a = SEMVER.exec(left.trim());
  const b = SEMVER.exec(right.trim());
  if (!a || !b) return compareGeneric(left, right);
  for (let index = 1; index <= 3; index++) {
    const order = Math.sign(Number(a[index]) - Number(b[index]));
    if (order !== 0) return order;
  }
  const preA = a[4];
  const preB = b[4];
  if (preA === undefined || preB === undefined) {
    // A pre-release sorts before its release.
    return preA === preB ? 0 : preA === undefined ? 1 : -1;
  }
  const partsA = preA.split(".");
  const partsB = preB.split(".");
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index++) {
    if (partsA[index] === undefined) return -1;
    if (partsB[index] === undefined) return 1;
    const order = compareIdentifiers(partsA[index], partsB[index]);
    if (order !== 0) return order;
  }
  return 0;
}
