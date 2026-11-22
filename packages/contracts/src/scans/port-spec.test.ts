import { describe, expect, it } from "vitest";

import { isPortSpecWithin, portSpecSize, unionPortSpecs } from "./port-spec";

describe("port specs", () => {
  it("merges overlapping and adjacent ranges", () => {
    expect(unionPortSpecs(["443,22,80-90", "85-100,101", "23"])).toBe("22-23,80-101,443");
  });

  it("counts ports", () => {
    expect(portSpecSize("22,80-89,80")).toBe(11);
  });

  it("checks a spec against the allowed ports", () => {
    expect(isPortSpecWithin("22,80-90", "1-1024")).toBe(true);
    expect(isPortSpecWithin("22,80-90", "22,80-85")).toBe(false);
    expect(isPortSpecWithin("80-90", "80-84,85-90")).toBe(true);
  });
});
