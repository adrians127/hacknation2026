/**
 * Debian package version order (deb-version(7)): `[epoch:]upstream[-revision]`.
 *
 * Epochs are dropped on both sides: a scanner reads the version from a banner, which never shows
 * the epoch (`OpenSSH_9.2p1 Debian-2+deb12u3` is package `1:9.2p1-2+deb12u3`).
 */

function order(char: string | undefined): number {
  if (char === undefined) return 0;
  if (char === "~") return -1;
  if (/[A-Za-z]/.test(char)) return char.charCodeAt(0);
  return char.charCodeAt(0) + 256;
}

/** dpkg's verrevcmp: alternating non-digit runs (by `order`) and digit runs (numerically). */
function compareFragment(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    while ((i < a.length && !/\d/.test(a[i])) || (j < b.length && !/\d/.test(b[j]))) {
      const left = i < a.length && !/\d/.test(a[i]) ? order(a[i]) : 0;
      const right = j < b.length && !/\d/.test(b[j]) ? order(b[j]) : 0;
      if (left !== right) return Math.sign(left - right);
      if (i < a.length && !/\d/.test(a[i])) i++;
      if (j < b.length && !/\d/.test(b[j])) j++;
    }
    let startI = i;
    let startJ = j;
    while (a[startI] === "0") startI++;
    while (b[startJ] === "0") startJ++;
    i = startI;
    j = startJ;
    while (i < a.length && /\d/.test(a[i])) i++;
    while (j < b.length && /\d/.test(b[j])) j++;
    const left = a.slice(startI, i);
    const right = b.slice(startJ, j);
    if (left.length !== right.length) return Math.sign(left.length - right.length);
    if (left !== right) return left < right ? -1 : 1;
  }
  return 0;
}

function split(version: string): { upstream: string; revision: string } {
  const withoutEpoch = version.trim().replace(/^\d+:/, "");
  const dash = withoutEpoch.lastIndexOf("-");
  return dash === -1
    ? { upstream: withoutEpoch, revision: "" }
    : { upstream: withoutEpoch.slice(0, dash), revision: withoutEpoch.slice(dash + 1) };
}

export function compareDpkg(left: string, right: string): number {
  const a = split(left);
  const b = split(right);
  return compareFragment(a.upstream, b.upstream) || compareFragment(a.revision, b.revision);
}

/** The upstream part only, for distributions where the scan did not reveal the revision. */
export function upstreamOfDpkg(version: string): string {
  return split(version).upstream;
}
