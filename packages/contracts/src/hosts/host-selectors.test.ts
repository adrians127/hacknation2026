import { describe, expect, it } from "vitest";

import { ipv4ToInt } from "../targets/ipv4";
import { HostSelectorSchema, parseHostSelectors, selectorRanges } from "./host-selectors";

const range = (from: string, to: string) => ({ start: ipv4ToInt(from), end: ipv4ToInt(to) });

describe("parseHostSelectors", () => {
  it("splits on commas, semicolons, spaces and new lines", () => {
    expect(parseHostSelectors(" 10.0.5.0/24,10.0.6.7 ;\n10.0.7.1\t10.0.8.0/30, ")).toEqual({
      selectors: ["10.0.5.0/24", "10.0.6.7", "10.0.7.1", "10.0.8.0/30"],
      invalid: [],
    });
  });

  it("clears CIDR host bits and drops repeats", () => {
    expect(parseHostSelectors("10.0.5.7/24, 10.0.5.0/24, 10.0.6.7, 10.0.6.7, 10.0.6.7/32")).toEqual({
      selectors: ["10.0.5.0/24", "10.0.6.7"],
      invalid: [],
    });
  });

  it("reports what is neither an address nor a CIDR", () => {
    expect(parseHostSelectors("10.0.0.300, example.com, 10.0.0.0/33, ::1, 10.0.0.1")).toEqual({
      selectors: ["10.0.0.1"],
      invalid: ["10.0.0.300", "example.com", "10.0.0.0/33", "::1"],
    });
  });

  it("returns nothing for blank input", () => {
    expect(parseHostSelectors("  \n , ")).toEqual({ selectors: [], invalid: [] });
  });

  it("produces selectors the request schema accepts", () => {
    const { selectors } = parseHostSelectors("10.0.5.7/24 10.0.6.7");
    expect(selectors.every((selector) => HostSelectorSchema.safeParse(selector).success)).toBe(true);
  });
});

describe("selectorRanges", () => {
  it("turns addresses and blocks into sorted, merged ranges", () => {
    expect(selectorRanges(["10.0.6.0/24", "10.0.9.1", "10.0.5.0/24", "10.0.5.10"])).toEqual([
      range("10.0.5.0", "10.0.6.255"),
      range("10.0.9.1", "10.0.9.1"),
    ]);
  });

  it("covers the whole space for 0.0.0.0/0", () => {
    expect(selectorRanges(["0.0.0.0/0"])).toEqual([range("0.0.0.0", "255.255.255.255")]);
  });
});
