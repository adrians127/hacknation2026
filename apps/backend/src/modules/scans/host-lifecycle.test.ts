import { describe, expect, it } from "vitest";

import { HostStatusSchema } from "@subsurf/contracts/workers/worker-result.schema";

import { hostLifecycle } from "~backend/modules/scans/host-lifecycle";

const sequence = (text: string) => text.split(" ").map((status) => HostStatusSchema.parse(status));

describe("hostLifecycle", () => {
  it.each([
    ["up up up", { state: "active", misses: 0, flips: 0 }],
    ["up", { state: "active", misses: 0, flips: 0 }],
    ["down up up", { state: "missing", misses: 1, flips: 1 }],
    ["down down up", { state: "missing", misses: 2, flips: 1 }],
    ["down down down up", { state: "inactive", misses: 3, flips: 1 }],
    ["down down down", { state: "inactive", misses: 3, flips: 0 }],
    ["up down up", { state: "unstable", misses: 0, flips: 2 }],
    ["down up down up", { state: "unstable", misses: 1, flips: 3 }],
    // Inactive wins over unstable: three nights in a row without an answer.
    ["down down down up down up", { state: "inactive", misses: 3, flips: 3 }],
  ] as const)("%s", (text, expected) => {
    expect(hostLifecycle(sequence(text))).toEqual(expected);
  });

  it("skips answers that say nothing", () => {
    expect(hostLifecycle(sequence("timeout down cancelled down failed up"))).toEqual({
      state: "missing",
      misses: 2,
      flips: 1,
    });
  });

  it("looks only at the latest conclusive answers", () => {
    const old = Array.from({ length: 10 }, (_, index) => (index % 2 === 0 ? "up" : "down"));
    expect(hostLifecycle(sequence(["up", ...Array(9).fill("up"), ...old].join(" ")))).toEqual({
      state: "active",
      misses: 0,
      flips: 0,
    });
  });
});
