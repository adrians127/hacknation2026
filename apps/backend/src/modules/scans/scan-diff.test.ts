import { describe, expect, it } from "vitest";

import { ipv4ToInt } from "@subsurf/contracts/targets/ipv4";

import type { HostObservationStatus } from "~backend/generated/prisma/client";
import {
  countChanges,
  diffScan,
  matchesChange,
  type ObservedPorts,
} from "~backend/modules/scans/scan-diff";

function observed(
  ip: string,
  status: HostObservationStatus,
  ports: Record<number, string> = {},
): ObservedPorts {
  return {
    ip,
    ipNumber: BigInt(ipv4ToInt(ip)),
    status,
    hostId: status === "up" ? `host-${ip}` : null,
    ports: Object.entries(ports).map(([port, fingerprint]) => ({
      serviceId: `service-${ip}-${port}`,
      protocol: "tcp" as const,
      port: Number(port),
      fingerprint,
    })),
  };
}

const changesOf = (entries: ReturnType<typeof diffScan>) =>
  Object.fromEntries(entries.map((entry) => [entry.ip, entry.change]));

describe("diffScan", () => {
  it("marks nothing without a base scan", () => {
    const [entry] = diffScan([observed("10.0.0.1", "up", { 22: "a" })], null);

    expect(entry).toMatchObject({ change: null, services: [{ port: 22, change: null }] });
  });

  it("classifies hosts: new, gone, unknown, changed and unchanged", () => {
    const base = [
      observed("10.0.0.1", "up", { 22: "a" }),
      observed("10.0.0.2", "up", { 22: "a" }),
      observed("10.0.0.3", "up", { 22: "a" }),
      observed("10.0.0.4", "up", { 22: "a", 80: "b" }),
      observed("10.0.0.5", "up", { 22: "a" }),
    ];
    const current = [
      observed("10.0.0.1", "up", { 22: "a" }),
      observed("10.0.0.2", "down"),
      observed("10.0.0.3", "timeout"),
      observed("10.0.0.4", "up", { 22: "a2", 443: "c" }),
      observed("10.0.0.9", "up", { 8080: "d" }),
      // 10.0.0.5 is outside this scan's coverage: left out, never "gone".
    ];

    const entries = diffScan(current, base);

    expect(changesOf(entries)).toEqual({
      "10.0.0.1": "unchanged",
      "10.0.0.2": "gone",
      "10.0.0.3": "unknown",
      "10.0.0.4": "changed",
      "10.0.0.9": "new",
    });
    const changed = entries.find((entry) => entry.ip === "10.0.0.4");
    expect(changed?.services.map((service) => [service.port, service.change, service.observedIn])).toEqual([
      [22, "changed", "current"],
      [80, "gone", "base"],
      [443, "new", "current"],
    ]);
    // A gone host is still the asset it was: its services come from the base scan.
    expect(entries.find((entry) => entry.ip === "10.0.0.2")).toMatchObject({
      hostId: "host-10.0.0.2",
      services: [{ port: 22, change: "gone", observedIn: "base" }],
    });
  });

  it("ignores addresses that were down before and are still not up", () => {
    expect(diffScan([observed("10.0.0.1", "down")], [observed("10.0.0.1", "down")])).toEqual([]);
  });

  it("counts changes, leaving out the services of unknown hosts", () => {
    const entries = diffScan(
      [
        observed("10.0.0.1", "up", { 22: "a2", 443: "c" }),
        observed("10.0.0.2", "timeout"),
        observed("10.0.0.3", "down"),
      ],
      [
        observed("10.0.0.1", "up", { 22: "a", 80: "b" }),
        observed("10.0.0.2", "up", { 22: "a" }),
        observed("10.0.0.3", "up", { 22: "a", 25: "e" }),
      ],
    );

    expect(countChanges(entries)).toEqual({
      hosts: { new: 0, gone: 1, changed: 1, unknown: 1 },
      services: { new: 1, gone: 3, changed: 1 },
    });
    expect(matchesChange("gone", "any")).toBe(true);
    expect(matchesChange("unknown", "any")).toBe(false);
    expect(matchesChange("unchanged", "changed")).toBe(false);
  });
});
