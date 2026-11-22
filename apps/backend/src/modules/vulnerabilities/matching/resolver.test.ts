import { describe, expect, it } from "vitest";

import { componentsOf } from "~backend/modules/vulnerabilities/components/component";
import {
  NO_DISTRO,
  type DistroHint,
} from "~backend/modules/vulnerabilities/components/distro-hint";
import {
  affected,
  NOT_AFFECTED,
  UNKNOWN,
  type Evaluation,
} from "~backend/modules/vulnerabilities/matchers/matcher";
import {
  resolveMatches,
  type RecordEvaluation,
  type RecordInfo,
} from "~backend/modules/vulnerabilities/matching/resolver";

const [ssh] = componentsOf({
  cpe: ["cpe:/a:openbsd:openssh:9.2p1"],
  version: "9.2p1",
  extraInfo: null,
});
const DEBIAN_12: DistroHint = { family: "Debian", release: "12", revision: "2+deb12u3" };

const record = (
  sourceId: string,
  externalId: string,
  extra: Partial<RecordInfo> = {},
): RecordInfo => ({
  vulnerabilityId: `${sourceId}-${externalId}`,
  sourceId,
  externalId,
  canonicalId: "CVE-2023-48795",
  title: `${sourceId} title`,
  severity: "medium",
  cvssScore: 5.9,
  kev: false,
  ...extra,
});

const NVD = record("nvd", "CVE-2023-48795");
const DEBIAN = record("osv", "DEBIAN-CVE-2023-48795", { severity: "unknown", cvssScore: null });

const evaluated = (info: RecordInfo, kind: string, evaluation: Evaluation): RecordEvaluation => ({
  record: info,
  kind,
  component: ssh,
  evaluation,
});

const precise = (evaluation: Evaluation): Evaluation => ({ ...evaluation, distroPrecise: true });

// Truth table: NVD's verdict, the Debian record's verdict (if any), the service's distribution.
type Case = [string, Evaluation, Evaluation | null, DistroHint];

const MATCHES: [...Case, string, string[]][] = [
  ["NVD hit, no distro", affected("confirmed"), null, NO_DISTRO, "confirmed", []],
  [
    "NVD hit on a distro without its data",
    affected("confirmed"),
    null,
    DEBIAN_12,
    "potential",
    ["distro_backport_possible"],
  ],
  [
    "Debian: fixed by backport",
    affected("confirmed"),
    precise(NOT_AFFECTED),
    DEBIAN_12,
    "potential",
    ["fixed_by_backport"],
  ],
  [
    "Debian: still vulnerable",
    affected("confirmed"),
    precise(affected("confirmed")),
    DEBIAN_12,
    "confirmed",
    [],
  ],
  [
    "Debian only, imprecise",
    NOT_AFFECTED,
    affected("potential", ["distro_backport_possible"]),
    DEBIAN_12,
    "potential",
    ["distro_backport_possible"],
  ],
  [
    "versionless",
    affected("potential", ["version_unknown"]),
    null,
    NO_DISTRO,
    "potential",
    ["version_unknown"],
  ],
];

const NO_MATCHES: Case[] = [
  ["nobody affected", NOT_AFFECTED, precise(NOT_AFFECTED), DEBIAN_12],
  ["unknown everywhere", UNKNOWN, UNKNOWN, NO_DISTRO],
];

function resolve(nvdVerdict: Evaluation, debianVerdict: Evaluation | null, distro: DistroHint) {
  const evaluations = [evaluated(NVD, "cpe", nvdVerdict)];
  if (debianVerdict) evaluations.push(evaluated(DEBIAN, "package", debianVerdict));
  return resolveMatches(evaluations, distro, ["nvd", "osv"]);
}

describe("resolveMatches", () => {
  it.each(MATCHES)("%s", (_name, nvdVerdict, debianVerdict, distro, confidence, reasons) => {
    const [match] = resolve(nvdVerdict, debianVerdict, distro);
    expect(match?.confidence).toBe(confidence);
    expect(match?.reasons).toEqual(reasons);
  });

  it.each(NO_MATCHES)("%s", (_name, nvdVerdict, debianVerdict, distro) => {
    expect(resolve(nvdVerdict, debianVerdict, distro)).toEqual([]);
  });

  it("shows the best record and keeps every source's verdict as evidence", () => {
    const [match] = resolveMatches(
      [
        evaluated(DEBIAN, "package", precise(affected("confirmed"))),
        evaluated({ ...NVD, kev: true }, "cpe", affected("confirmed")),
      ],
      DEBIAN_12,
      ["nvd", "osv"],
    );
    expect(match.best).toMatchObject({ sourceId: "nvd", title: "nvd title" });
    expect(match.kev).toBe(true);
    expect(match.evidence.map((entry) => [entry.sourceId, entry.verdict])).toEqual([
      ["nvd", "affected"],
      ["osv", "affected"],
    ]);
  });

  it("borrows another source's title when the shown record has none", () => {
    const [match] = resolveMatches(
      [
        evaluated({ ...NVD, title: null }, "cpe", affected("confirmed")),
        evaluated({ ...DEBIAN, title: "Terrapin" }, "package", affected("potential")),
      ],
      NO_DISTRO,
      ["nvd", "osv"],
    );
    expect(match.best).toMatchObject({ sourceId: "nvd", title: "Terrapin" });
  });

  it("counts a package source's hit as more than upstream evidence", () => {
    const jetty = record("osv", "GHSA-xxxx", { canonicalId: "CVE-2024-1" });
    const evaluations = [evaluated(jetty, "package", affected("confirmed"))];
    const [match] = resolveMatches(evaluations, DEBIAN_12, ["nvd", "osv"]);
    expect(match.confidence).toBe("confirmed");
  });
});
