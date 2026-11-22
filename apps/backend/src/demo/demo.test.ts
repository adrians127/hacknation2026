import { describe, expect, it } from "vitest";

import { cidrToRange, parseCidr } from "@subsurf/contracts/targets/ipv4";
import {
  WorkerResultSchema,
  type ObservedHost,
  type WorkerResult,
} from "@subsurf/contracts/workers/worker-result.schema";

import { DEMO_NETWORK, DEMO_SCAN_PORTS, demoDomainHosts, demoNetwork } from "~backend/demo/network";
import { buildDemoRun, DEMO_RUNS, type DemoJob } from "~backend/demo/runs";
import { portsOutsideSpec } from "~backend/modules/results/job-scope";
import { planScanJobs } from "~backend/modules/scans/batching";
import { hostLifecycle } from "~backend/modules/scans/host-lifecycle";

const jobs: DemoJob[] = planScanJobs([cidrToRange(parseCidr(DEMO_NETWORK))], demoDomainHosts(), 256).map(
  (job, index) => ({
    id: `0193f0d0-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
    sequence: index + 1,
    subnet: job.subnet,
    targets: job.targets,
  }),
);
const runs = DEMO_RUNS.map((run) => buildDemoRun(run, jobs));
const [first, second, , fourth] = runs;
const results = (run: typeof first) => run.map((entry) => entry.result);
const hostsOf = (run: typeof first) => results(run).flatMap((result) => result.hosts);

function upHosts(run: typeof first): Map<string, ObservedHost> {
  return new Map(hostsOf(run).filter((host) => host.status === "up").map((host) => [host.ip, host]));
}

function portKey(host: ObservedHost) {
  return host.ports.map((port) => `${port.port}:${port.service?.product}:${port.service?.version}`);
}

describe("demo scan data", () => {
  it("covers a /18 in 64 jobs of 256 addresses, every address exactly once per run", () => {
    expect(jobs).toHaveLength(64);
    expect(runs).toHaveLength(4);
    for (const run of runs) {
      const ips = hostsOf(run).map((host) => host.ip);
      expect(ips).toHaveLength(16_384);
      expect(new Set(ips).size).toBe(16_384);
    }
  });

  it("produces results in the locked worker format, with consistent counts and ports", () => {
    for (const result of runs.flatMap(results)) {
      const parsed: WorkerResult = WorkerResultSchema.parse(result);
      const { counts } = parsed.scan;
      const count = (status: ObservedHost["status"]) =>
        parsed.hosts.filter((host) => host.status === status).length;
      expect(counts).toMatchObject({
        addresses: parsed.hosts.length,
        up: count("up"),
        down: count("down"),
        timeout: count("timeout"),
        cancelled: count("cancelled"),
      });
      expect(counts.openPorts).toBe(parsed.hosts.reduce((sum, host) => sum + host.ports.length, 0));
      const ports = parsed.hosts.flatMap((host) => host.ports.map((port) => port.port));
      expect(portsOutsideSpec(DEMO_SCAN_PORTS, ports)).toEqual([]);
      expect(Date.parse(parsed.scan.finishedAt) - Date.parse(parsed.scan.startedAt)).toBe(
        parsed.scan.durationMs,
      );
    }
  });

  it("is deterministic", () => {
    expect(buildDemoRun(DEMO_RUNS[0], jobs)).toEqual(first);
    expect(demoNetwork()).toHaveLength(new Set(demoNetwork().map((host) => host.ip)).size);
  });

  it("has a realistic number of live hosts and HTTP endpoints", () => {
    const up = upHosts(first);
    expect(up.size).toBeGreaterThanOrEqual(230);
    expect(up.size).toBeLessThanOrEqual(270);
    const endpoints = [...up.values()].flatMap((host) => host.ports.flatMap((port) => port.http));
    expect(endpoints.length).toBeGreaterThan(80);
    expect(endpoints.some((entry) => entry.tls?.cert.selfSigned)).toBe(true);
    const headerNames = endpoints.flatMap((entry) => entry.headers.map((header) => header.name));
    expect(headerNames).toContain("x-environment");
  });

  it("changes between runs: new, gone, unstable and changed services, and a deadline", () => {
    const before = upHosts(first);
    const after = upHosts(second);
    const secondStatus = new Map(hostsOf(second).map((host) => [host.ip, host.status]));

    const appeared = [...after.keys()].filter((ip) => !before.has(ip));
    const gone = [...before.keys()].filter((ip) => secondStatus.get(ip) === "down");
    const unknown = [...before.keys()].filter((ip) =>
      ["timeout", "cancelled"].includes(secondStatus.get(ip) ?? ""),
    );
    const changed = [...before].filter(([ip, host]) => {
      const later = after.get(ip);
      return later !== undefined && portKey(host).join() !== portKey(later).join();
    });

    expect(appeared.length).toBeGreaterThanOrEqual(8);
    expect(gone.length).toBeGreaterThanOrEqual(6);
    expect(unknown.length).toBeGreaterThanOrEqual(8);
    expect(changed.length).toBeGreaterThanOrEqual(15);
    expect(appeared).toContain("10.40.4.14");

    const deadline = second.filter((entry) => entry.hitDeadline);
    expect(deadline).toHaveLength(1);
    expect(deadline[0].result.scan).toMatchObject({ status: "partial", stopReason: "deadline" });
    expect(deadline[0].result.scan.counts.cancelled).toBe(128);
  });

  it("has unstable and inactive hosts by the fourth run, and one new admin panel", () => {
    const statuses = new Map<string, ObservedHost["status"][]>();
    for (const run of runs.toReversed()) {
      for (const host of hostsOf(run)) statuses.set(host.ip, [...(statuses.get(host.ip) ?? []), host.status]);
    }
    const lifecycleOf = (ip: string) => hostLifecycle(statuses.get(ip) ?? []).state;
    const states = [...statuses.keys()].map(lifecycleOf);

    expect(states.filter((state) => state === "inactive").length).toBeGreaterThanOrEqual(6);
    expect(states.filter((state) => state === "unstable").length).toBeGreaterThanOrEqual(4);
    expect(lifecycleOf("10.40.1.21")).toBe("inactive");
    expect(lifecycleOf("10.40.4.15")).toBe("unstable");
    expect(upHosts(fourth).has("10.40.4.17")).toBe(true);
    expect(fourth.some((entry) => entry.hitDeadline)).toBe(false);
  });
});
