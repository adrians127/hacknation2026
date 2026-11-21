import { describe, expect, it } from "vitest";

import {
  cpeMatchKey,
  isUsableVersion,
  joinedVersion,
  parseCpe,
} from "~backend/modules/vulnerabilities/cpe/cpe";

describe("CPE names", () => {
  it("parses nmap's 2.2 URIs, percent-encoding included", () => {
    expect(parseCpe("cpe:/a:openbsd:openssh:9.6p1")).toEqual({
      part: "a",
      vendor: "openbsd",
      product: "openssh",
      version: "9.6p1",
      update: null,
    });
    expect(parseCpe("cpe:/a:joomla:joomla%21:4.4")?.product).toBe("joomla!");
    expect(parseCpe("cpe:/o:linux:linux_kernel")?.version).toBeNull();
  });

  it("parses NVD's 2.3 strings with escapes", () => {
    const cpe = parseCpe(String.raw`cpe:2.3:a:openbsd:openssh:9.6:p1:*:*:*:*:*:*`);
    expect(cpe && joinedVersion(cpe)).toBe("9.6p1");
    const joomla = parseCpe(String.raw`cpe:2.3:a:joomla:joomla\!:*:*:*:*:*:*:*:*`);
    expect(joomla?.product).toBe("joomla!");
    expect(parseCpe("cpe:2.3:a:nginx:nginx:-:*:*:*:*:*:*:*")?.version).toBe("-");
    expect(parseCpe("not a cpe")).toBeNull();
  });

  it("keys by part, vendor and product only", () => {
    const nmap = parseCpe("cpe:/a:nginx:nginx:1.24.0");
    const nvd = parseCpe("cpe:2.3:a:nginx:nginx:*:*:*:*:*:*:*:*");
    expect(nmap && cpeMatchKey(nmap)).toBe("cpe:a:nginx:nginx");
    expect(nvd && cpeMatchKey(nvd)).toBe("cpe:a:nginx:nginx");
  });

  it.each([
    ["5.X", false],
    ["2.4.x", false],
    ["1.0 - 1.4", false],
    ["*", false],
    ["-", false],
    [null, false],
    ["9.6p1", true],
    ["10.0", true],
    ["0.94.14rc21", true],
    ["2019", true],
  ] as const)("treats %s as a usable version: %s", (version, usable) => {
    expect(isUsableVersion(version)).toBe(usable);
  });
});
