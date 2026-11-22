import { describe, expect, it } from "vitest";

import { formatUtcOffset, serviceLabel } from "@/features/reports/lib/format";

describe("report formatting", () => {
  it("labels a service by product, version and name", () => {
    expect(serviceLabel({ name: "http", product: "nginx", version: "1.24.0" })).toBe("nginx 1.24.0 (http)");
    expect(serviceLabel({ name: "ssh", product: null, version: null })).toBe("ssh");
    expect(serviceLabel({ name: null, product: null, version: null })).toBe("—");
  });

  it("writes UTC offsets with a sign", () => {
    expect(formatUtcOffset(60)).toBe("+01:00");
    expect(formatUtcOffset(-330)).toBe("-05:30");
    expect(formatUtcOffset(0)).toBe("+00:00");
  });
});
