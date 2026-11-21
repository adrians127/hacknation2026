import { describe, expect, it } from "vitest";

import { detectTargetKind } from "@/features/targets/api/mocks";

describe("detectTargetKind", () => {
  it("tells IP addresses, CIDR ranges and domains apart", () => {
    expect(detectTargetKind("192.0.2.15")).toBe("ip");
    expect(detectTargetKind("10.20.0.0/16")).toBe("cidr");
    expect(detectTargetKind("example-agh.pl")).toBe("domain");
  });
});
