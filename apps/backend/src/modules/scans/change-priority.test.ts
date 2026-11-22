import { describe, expect, it } from "vitest";

import type { ScanChangeRow } from "@subsurf/contracts/scans/scan-changes.schema";

import { rateChange } from "~backend/modules/scans/change-priority";

type Facts = Omit<ScanChangeRow, "priority" | "reason">;

const base: Facts = {
  hostId: "0193f0d0-0000-7000-8000-000000000001",
  ip: "10.0.0.1",
  hostnames: [],
  protocol: "tcp",
  port: 443,
  change: "changed",
  field: null,
  endpoint: null,
  key: null,
  before: null,
  after: null,
  lifecycle: "active",
};

const rate = (facts: Partial<Facts>) => {
  const { priority, reason } = rateChange({ ...base, ...facts });
  return `${priority} ${reason}`;
};

describe("rateChange", () => {
  it("rates hosts by what they did and how reliably they answer", () => {
    expect(rate({ port: null, protocol: null, change: "new" })).toBe("high new-host");
    expect(rate({ port: null, protocol: null, change: "new", lifecycle: "unstable" })).toBe("medium returning-host");
    expect(rate({ port: null, protocol: null, change: "gone", lifecycle: "missing" })).toBe("low host-gone");
    expect(rate({ port: null, protocol: null, change: "gone", lifecycle: "inactive" })).toBe("medium host-inactive");
    expect(rate({ port: null, protocol: null, change: "unknown" })).toBe("low no-answer");
  });

  it("rates opened ports by how exposed they are", () => {
    expect(rate({ port: 3389, change: "new" })).toBe("high risky-port");
    expect(rate({ port: 8080, change: "new" })).toBe("medium new-service");
    expect(rate({ port: 3389, change: "gone" })).toBe("low service-gone");
  });

  it("rates field changes", () => {
    expect(rate({ field: "ssh.hostKey" })).toBe("high ssh-key-changed");
    expect(rate({ field: "tls.selfSigned", before: "false", after: "true" })).toBe("high self-signed");
    expect(rate({ field: "http.probe", key: "/wp-admin/", before: "404", after: "200" })).toBe("high admin-panel");
    expect(rate({ field: "http.probe", key: "/version", before: "404", after: "200" })).toBe("medium page-change");
    expect(rate({ field: "service.version", before: "1.22.1", after: "1.24.0" })).toBe("medium version-change");
    expect(rate({ field: "tls.expiry" })).toBe("medium cert-change");
    expect(rate({ field: "http.securityHeader", key: "strict-transport-security", before: "max-age=1" })).toBe(
      "medium security-header-removed",
    );
    expect(rate({ field: "http.cookieFlags", before: "Secure, HttpOnly", after: "Secure" })).toBe(
      "medium cookie-flags-weakened",
    );
    expect(rate({ field: "http.cookieFlags", before: "Secure", after: "Secure, HttpOnly" })).toBe("low other");
    expect(rate({ field: "http.favicon" })).toBe("low other");
  });
});
