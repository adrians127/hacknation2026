import { describe, expect, it } from "vitest";

import { cidrToRange, parseCidr } from "@subsurf/contracts/targets/ipv4";

import { intersectRanges } from "~backend/modules/pipelines/target-selection";

const cidr = (value: string) => cidrToRange(parseCidr(value));

describe("intersectRanges", () => {
  it("keeps only the parts inside the selector's ranges", () => {
    expect(intersectRanges([cidr("10.0.0.0/16")], [cidr("10.0.4.0/24"), cidr("10.1.0.0/24")])).toEqual([
      cidr("10.0.4.0/24"),
    ]);
  });

  it("clips a range that only partly overlaps", () => {
    const upperHalfAndBeyond = { start: cidr("10.0.0.128/25").start, end: cidr("10.0.1.0/24").end };
    expect(intersectRanges([cidr("10.0.0.0/24")], [upperHalfAndBeyond])).toEqual([cidr("10.0.0.128/25")]);
  });

  it("returns nothing for disjoint ranges", () => {
    expect(intersectRanges([cidr("10.0.0.0/24")], [cidr("10.0.1.0/24")])).toEqual([]);
  });
});
