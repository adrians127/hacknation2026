import { describe, expect, it } from "vitest";

import {
  componentsOf,
  type Component,
} from "~backend/modules/vulnerabilities/components/component";
import {
  cpeMatcher,
  type CpeCriterionData,
} from "~backend/modules/vulnerabilities/matchers/cpe.matcher";
import type { MatchContext } from "~backend/modules/vulnerabilities/matchers/matcher";
import {
  packageMatcher,
  type PackageCriterionData,
} from "~backend/modules/vulnerabilities/matchers/package.matcher";

function component(cpe: string, extraInfo: string | null = null, platforms: string[] = []) {
  const [first] = componentsOf({ cpe: [cpe, ...platforms], version: null, extraInfo });
  if (!first) throw new Error(`No component for ${cpe}`);
  return first;
}

const openssh = (version: string, extraInfo: string | null = null, platforms: string[] = []) =>
  component(`cpe:/a:openbsd:openssh:${version}`, extraInfo, platforms);

const nvd = (data: CpeCriterionData, target: Component) =>
  cpeMatcher.prepare(data)("cpe:a:openbsd:openssh", target);

describe("cpe matcher", () => {
  const regreSSHion: CpeCriterionData = {
    conditions: [{ startIncluding: "8.5", endExcluding: "9.8" }, { endExcluding: "4.4" }],
  };

  it("matches version ranges, update fields joined", () => {
    expect(nvd(regreSSHion, openssh("9.6p1"))).toMatchObject({
      verdict: "affected",
      confidence: "confirmed",
    });
    expect(nvd(regreSSHion, openssh("9.8p1")).verdict).toBe("not_affected");
    expect(nvd(regreSSHion, openssh("8.4p1")).verdict).toBe("not_affected");
    expect(nvd({ conditions: [{ versions: ["9.6p1"] }] }, openssh("9.6p1")).verdict).toBe(
      "affected",
    );
  });

  it("calls a versionless service potential", () => {
    expect(nvd(regreSSHion, component("cpe:/a:openbsd:openssh"))).toMatchObject({
      verdict: "affected",
      confidence: "potential",
      reasons: ["version_unknown"],
    });
  });

  it("checks platform conditions against the service's OS hints", () => {
    const onWindows: CpeCriterionData = {
      conditions: [
        {
          endExcluding: "9.8",
          platforms: [{ part: "o", vendor: "microsoft", product: "windows", version: null }],
        },
      ],
    };
    const windows = openssh("9.6p1", null, ["cpe:/o:microsoft:windows:10"]);
    const linux = openssh("9.6p1", null, ["cpe:/o:linux:linux_kernel:5.4"]);
    expect(nvd(onWindows, windows).confidence).toBe("confirmed");
    expect(nvd(onWindows, linux).verdict).toBe("not_affected");
    expect(nvd(onWindows, openssh("9.6p1"))).toMatchObject({
      confidence: "potential",
      reasons: ["platform_condition"],
    });
  });
});

const context: MatchContext = {
  packages: new Map([
    [
      "openbsd:openssh",
      [
        { ecosystem: "Debian", packageName: "openssh" },
        { ecosystem: "Alpine", packageName: "openssh" },
      ],
    ],
    ["eclipse:jetty", [{ ecosystem: "Maven", packageName: "org.eclipse.jetty:jetty-server" }]],
  ]),
};

const terrapinDebian: PackageCriterionData = {
  entries: [
    {
      ecosystem: "Debian",
      release: "12",
      versions: ["1:9.2p1-2", "1:9.2p1-2+deb12u1"],
      ranges: [
        { type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1:9.2p1-2+deb12u2" }] },
      ],
    },
    {
      ecosystem: "Debian",
      release: "13",
      versions: [],
      ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1:9.6p1-1" }] }],
    },
  ],
};

const debian = (target: Component) =>
  packageMatcher.prepare(terrapinDebian)("pkg:Debian:openssh", target);

describe("package matcher", () => {
  it("reaches distribution packages only on that distribution", () => {
    expect(packageMatcher.keysFor(openssh("9.2p1", "Debian 2+deb12u3"), context)).toEqual([
      "pkg:Debian:openssh",
    ]);
    expect(packageMatcher.keysFor(openssh("9.2p1"), context)).toEqual([]);
    expect(packageMatcher.keysFor(component("cpe:/a:eclipse:jetty:10.0.20"), context)).toEqual([
      "pkg:Maven:org.eclipse.jetty:jetty-server",
    ]);
  });

  it("compares the exact Debian package revision of the right release", () => {
    expect(debian(openssh("9.2p1", "Debian 2+deb12u3"))).toMatchObject({
      verdict: "not_affected",
      distroPrecise: true,
    });
    expect(debian(openssh("9.2p1", "Debian 2+deb12u1"))).toMatchObject({
      verdict: "affected",
      confidence: "confirmed",
      distroPrecise: true,
    });
  });

  it("falls back to upstream versions without the revision, as potential", () => {
    expect(debian(openssh("9.1p1", "(Debian)"))).toMatchObject({
      verdict: "affected",
      confidence: "potential",
      reasons: ["distro_backport_possible"],
      distroPrecise: false,
    });
  });

  it("matches language packages by enumerated versions or ranges", () => {
    const data: PackageCriterionData = {
      entries: [
        {
          ecosystem: "Maven",
          release: null,
          versions: [],
          ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "10.0.0" }, { fixed: "10.0.22" }] }],
        },
      ],
    };
    const jetty = (version: string) =>
      packageMatcher.prepare(data)(
        "pkg:Maven:org.eclipse.jetty:jetty-server",
        component(`cpe:/a:eclipse:jetty:${version}`),
      ).verdict;
    expect(jetty("10.0.20")).toBe("affected");
    expect(jetty("10.0.22")).toBe("not_affected");
    expect(jetty("9.4.50")).toBe("not_affected");
  });
});
