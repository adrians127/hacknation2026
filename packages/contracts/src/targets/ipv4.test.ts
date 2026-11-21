import { describe, expect, it } from "vitest";

import {
  cidrToRange,
  coveringCidr,
  formatCidr,
  intToIpv4,
  ipv4ToInt,
  mergeRanges,
  overlapsReserved,
  parseCidr,
  rangeToCidrs,
} from "./ipv4";

const range = (from: string, to: string) => ({ start: ipv4ToInt(from), end: ipv4ToInt(to) });

describe("ipv4 conversions", () => {
  it("round-trips addresses across the whole space", () => {
    for (const ip of ["0.0.0.0", "10.20.30.40", "192.168.1.255", "255.255.255.255"]) {
      expect(intToIpv4(ipv4ToInt(ip))).toBe(ip);
    }
    expect(ipv4ToInt("255.255.255.255")).toBe(2 ** 32 - 1);
  });

  it("clears host bits when parsing a CIDR", () => {
    expect(parseCidr("10.0.0.5/24")).toEqual({ network: ipv4ToInt("10.0.0.0"), prefix: 24 });
    expect(formatCidr(parseCidr("10.0.0.5/24"))).toBe("10.0.0.0/24");
    expect(formatCidr(parseCidr("10.0.0.5/32"))).toBe("10.0.0.5");
    expect(cidrToRange(parseCidr("192.0.2.0/30"))).toEqual(range("192.0.2.0", "192.0.2.3"));
  });
});

describe("overlapsReserved", () => {
  it("flags loopback, link-local, multicast and the reserved block, not private ranges", () => {
    expect(overlapsReserved(range("127.0.0.1", "127.0.0.1"))).toBe(true);
    expect(overlapsReserved(range("169.254.10.0", "169.254.10.255"))).toBe(true);
    expect(overlapsReserved(range("239.1.1.1", "239.1.1.1"))).toBe(true);
    expect(overlapsReserved(range("255.255.255.255", "255.255.255.255"))).toBe(true);
    expect(overlapsReserved(range("10.0.0.0", "10.0.255.255"))).toBe(false);
    expect(overlapsReserved(range("192.168.0.1", "192.168.0.1"))).toBe(false);
  });
});

describe("mergeRanges", () => {
  it("joins overlapping and adjacent ranges and sorts them", () => {
    expect(
      mergeRanges([
        range("10.0.1.0", "10.0.1.255"),
        range("10.0.0.7", "10.0.0.7"),
        range("10.0.0.0", "10.0.0.255"),
        range("10.0.3.0", "10.0.3.0"),
      ]),
    ).toEqual([range("10.0.0.0", "10.0.1.255"), range("10.0.3.0", "10.0.3.0")]);
  });
});

describe("rangeToCidrs", () => {
  it("covers an aligned range with one block", () => {
    expect(rangeToCidrs(range("10.0.0.0", "10.0.3.255")).map(formatCidr)).toEqual(["10.0.0.0/22"]);
  });

  it("covers an unaligned range with the fewest blocks", () => {
    expect(rangeToCidrs(range("10.0.0.1", "10.0.0.6")).map(formatCidr)).toEqual([
      "10.0.0.1",
      "10.0.0.2/31",
      "10.0.0.4/31",
      "10.0.0.6",
    ]);
  });
});

describe("coveringCidr", () => {
  it("finds the smallest aligned block around a range", () => {
    expect(formatCidr(coveringCidr(range("10.0.0.10", "10.0.0.10")))).toBe("10.0.0.10");
    expect(formatCidr(coveringCidr(range("10.0.0.10", "10.0.0.20")))).toBe("10.0.0.0/27");
    expect(formatCidr(coveringCidr(range("10.0.0.255", "10.0.1.0")))).toBe("10.0.0.0/23");
  });
});
