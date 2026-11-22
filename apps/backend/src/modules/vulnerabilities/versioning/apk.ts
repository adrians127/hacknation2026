import { compareGeneric } from "~backend/modules/vulnerabilities/versioning/generic";

function split(version: string): { upstream: string; revision: number } {
  const match = /^(.*)-r(\d+)$/.exec(version.trim());
  return match
    ? { upstream: match[1], revision: Number(match[2]) }
    : { upstream: version, revision: 0 };
}

/** Alpine apk versions, `1.2.3[_suffix]-rN`: `_alpha`…`_rc` sort before, `_p`, `_git` after. */
export function compareApk(left: string, right: string): number {
  const a = split(left);
  const b = split(right);
  return compareGeneric(a.upstream, b.upstream) || Math.sign(a.revision - b.revision);
}

export function upstreamOfApk(version: string): string {
  return split(version).upstream;
}
