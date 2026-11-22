import { describe, expect, it } from "vitest";

import type { ScanChangeRow } from "@subsurf/contracts/scans/scan-changes.schema";

import { groupChanges, topChanges } from "~backend/modules/dashboard/top-changes";

const HOST_A = "0193f0d0-0000-7000-8000-00000000000a";
const HOST_B = "0193f0d0-0000-7000-8000-00000000000b";

function row(facts: Partial<ScanChangeRow>): ScanChangeRow {
  return {
    hostId: HOST_A,
    ip: "10.0.0.1",
    hostnames: [],
    protocol: "tcp",
    port: 22,
    change: "changed",
    field: null,
    endpoint: null,
    key: null,
    before: null,
    after: null,
    priority: "low",
    reason: "other",
    lifecycle: { state: "active", misses: 0, flips: 0 },
    ...facts,
  };
}

describe("groupChanges", () => {
  it("makes one item of a new host and its ports, rated by its most important row", () => {
    const [item] = groupChanges([
      row({ port: null, protocol: null, change: "new", before: "down", after: "up", priority: "high", reason: "new-host" }),
      row({ port: 22, change: "new", priority: "medium", reason: "new-service" }),
      row({ port: 3389, change: "new", priority: "high", reason: "risky-port" }),
    ]);

    expect(item).toMatchObject({
      port: null,
      change: "new",
      priority: "high",
      reasons: ["new-host", "risky-port", "new-service"],
      ports: [22, 3389],
      fields: [],
    });
  });

  it("makes one item per changed service, with its fields", () => {
    const items = groupChanges([
      row({ field: "service.version", before: "8.9", after: "9.6", priority: "medium", reason: "version-change" }),
      row({ field: "ssh.hostKey", priority: "high", reason: "ssh-key-changed" }),
      row({ port: 443, field: "http.title", priority: "medium", reason: "page-change" }),
    ]);

    expect(items.map((item) => [item.port, item.priority, item.fields.map((field) => field.field)])).toEqual([
      [22, "high", ["service.version", "ssh.hostKey"]],
      [443, "medium", ["http.title"]],
    ]);
  });

  it("lists the most important first, keeping address order among equals", () => {
    const items = topChanges(
      groupChanges([
        row({ port: 80, change: "new", priority: "medium", reason: "new-service" }),
        row({ hostId: HOST_B, ip: "10.0.0.2", port: 23, change: "new", priority: "high", reason: "risky-port" }),
        row({ port: 25, change: "gone", priority: "low", reason: "service-gone" }),
      ]),
    );

    expect(items.map((item) => [item.ip, item.port])).toEqual([
      ["10.0.0.2", 23],
      ["10.0.0.1", 80],
      ["10.0.0.1", 25],
    ]);
  });
});
