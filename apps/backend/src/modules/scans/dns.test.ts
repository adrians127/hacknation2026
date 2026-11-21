import { describe, expect, it, vi } from "vitest";

const resolve4 = vi.hoisted(() => vi.fn<(domain: string) => Promise<string[]>>());

vi.mock("node:dns/promises", () => ({
  Resolver: class {
    resolve4 = resolve4;
  },
}));

const { resolveDomains } = await import("~backend/modules/scans/dns");

const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe("resolveDomains", () => {
  it("returns A records and turns failures into warnings", async () => {
    resolve4.mockImplementation(async (domain) => {
      switch (domain) {
        case "app.example.com":
          return ["192.0.2.10", "192.0.2.11"];
        case "mixed.example.com":
          return ["127.0.0.1", "198.51.100.7"];
        case "local.example.com":
          return ["127.0.0.1"];
        case "missing.example.com":
          throw dnsError("ENOTFOUND");
        case "empty.example.com":
          throw dnsError("ENODATA");
        case "slow.example.com":
          throw dnsError("ETIMEOUT");
        default:
          throw dnsError("ESERVFAIL");
      }
    });

    const result = await resolveDomains([
      "app.example.com",
      "mixed.example.com",
      "local.example.com",
      "missing.example.com",
      "empty.example.com",
      "slow.example.com",
      "broken.example.com",
    ]);

    expect(result.resolved).toEqual([
      { domain: "app.example.com", addresses: ["192.0.2.10", "192.0.2.11"] },
      { domain: "mixed.example.com", addresses: ["198.51.100.7"] },
    ]);
    expect(result.warnings).toEqual([
      { code: "dns_failed", value: "broken.example.com" },
      { code: "dns_no_addresses", value: "empty.example.com" },
      { code: "resolves_to_reserved", value: "local.example.com" },
      { code: "dns_not_found", value: "missing.example.com" },
      { code: "resolves_to_reserved", value: "mixed.example.com" },
      { code: "dns_timeout", value: "slow.example.com" },
    ]);
  });

  it("does nothing without domains", async () => {
    resolve4.mockClear();
    expect(await resolveDomains([])).toEqual({ resolved: [], warnings: [] });
    expect(resolve4).not.toHaveBeenCalled();
  });
});
