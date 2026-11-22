import { describe, expect, it } from "vitest";

import { compareApk } from "~backend/modules/vulnerabilities/versioning/apk";
import { compareDpkg } from "~backend/modules/vulnerabilities/versioning/dpkg";
import { compareGeneric } from "~backend/modules/vulnerabilities/versioning/generic";
import { compareMaven } from "~backend/modules/vulnerabilities/versioning/maven";
import { compareSemver } from "~backend/modules/vulnerabilities/versioning/semver";

type Comparator = (a: string, b: string) => number;

// Each row: [comparator name, comparator, lower, higher].
const ASCENDING: [string, Comparator, string, string][] = [
  ["generic", compareGeneric, "2.4.9", "2.4.58"],
  ["generic", compareGeneric, "7.17.9", "7.17.10"],
  ["generic", compareGeneric, "1.0rc1", "1.0"],
  ["generic", compareGeneric, "1.0.0rc1", "1.0"],
  ["generic", compareGeneric, "1.0beta2", "1.0rc1"],
  ["generic", compareGeneric, "1.0alpha", "1.0beta"],
  ["generic", compareGeneric, "9.6", "9.6p1"],
  ["generic", compareGeneric, "9.6p1", "9.6p2"],
  ["generic", compareGeneric, "9.6p1", "9.8"],
  ["generic", compareGeneric, "9.6p1", "9.6.1"],
  ["generic", compareGeneric, "1.0.2", "1.0.2k"],
  ["generic", compareGeneric, "1.0.2k", "1.0.2l"],
  ["generic", compareGeneric, "1.0.2k", "1.0.3"],
  ["generic", compareGeneric, "0.94.14rc21", "0.94.14rc22"],
  ["dpkg", compareDpkg, "9.2p1-2+deb12u2", "9.2p1-2+deb12u3"],
  ["dpkg", compareDpkg, "9.2p1-2", "9.2p1-2+deb12u1"],
  ["dpkg", compareDpkg, "1.0~rc1-1", "1.0-1"],
  ["dpkg", compareDpkg, "2.4.57-2", "2.4.62-1~deb12u1"],
  ["dpkg, epoch ignored", compareDpkg, "1:9.2p1-2+deb12u2", "9.2p1-2+deb12u3"],
  ["apk", compareApk, "9.7_p1-r0", "9.7_p1-r1"],
  ["apk", compareApk, "1.2.3_rc1-r0", "1.2.3-r0"],
  ["apk", compareApk, "1.2.3-r0", "1.2.3_p1-r0"],
  ["semver", compareSemver, "1.0.0-alpha", "1.0.0"],
  ["semver", compareSemver, "1.0.0-alpha", "1.0.0-alpha.1"],
  ["semver", compareSemver, "1.0.0-alpha.1", "1.0.0-beta"],
  ["semver", compareSemver, "1.0.0-beta.2", "1.0.0-beta.11"],
  ["semver", compareSemver, "v1.2.3", "1.10.0"],
  ["maven", compareMaven, "10.0.0-SNAPSHOT", "10.0.0"],
  ["maven", compareMaven, "9.4.51.v20230217", "9.4.52.v20230823"],
  ["maven", compareMaven, "1.0-rc1", "1.0-SNAPSHOT"],
];

const EQUAL: [string, Comparator, string, string][] = [
  ["generic", compareGeneric, "1.0", "1.0.0"],
  ["generic", compareGeneric, "2.0-final", "2.0"],
  ["dpkg", compareDpkg, "9.2p1-2+deb12u2", "1:9.2p1-2+deb12u2"],
];

describe("version comparators", () => {
  it.each(ASCENDING)("%s: %s < %s", (_name, compare, lower, higher) => {
    expect(compare(lower, higher)).toBe(-1);
    expect(compare(higher, lower)).toBe(1);
  });

  it.each(EQUAL)("%s: %s = %s", (_name, compare, left, right) => {
    expect(compare(left, right)).toBe(0);
  });
});
