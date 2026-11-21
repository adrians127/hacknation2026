import { describe, expect, it } from "vitest";

import { cidrToRange, ipv4ToInt, parseCidr } from "@hacknation/contracts/targets/ipv4";

import { planScanJobs } from "~backend/modules/scans/batching";

const cidr = (value: string) => cidrToRange(parseCidr(value));
const ip = (value: string) => ({ start: ipv4ToInt(value), end: ipv4ToInt(value) });

describe("planScanJobs", () => {
  it("splits a range into aligned batches", () => {
    const jobs = planScanJobs([cidr("10.0.0.0/22")], [], 256);
    expect(jobs.map((job) => [job.subnet, job.targets, job.addressCount])).toEqual([
      ["10.0.0.0/24", ["10.0.0.0/24"], 256],
      ["10.0.1.0/24", ["10.0.1.0/24"], 256],
      ["10.0.2.0/24", ["10.0.2.0/24"], 256],
      ["10.0.3.0/24", ["10.0.3.0/24"], 256],
    ]);
    expect(planScanJobs([cidr("10.20.0.0/16")], [], 256)).toHaveLength(256);
    expect(planScanJobs([cidr("10.20.0.0/16")], [], 1024)).toHaveLength(64);
  });

  it("packs scattered addresses of one /16 into one job", () => {
    const jobs = planScanJobs([ip("10.0.200.1"), ip("10.0.3.7"), ip("10.0.9.9")], [], 256);
    expect(jobs).toEqual([
      { subnet: "10.0.0.0/16", targets: ["10.0.3.7", "10.0.9.9", "10.0.200.1"], hosts: [], addressCount: 3 },
    ]);
  });

  it("never mixes two /16 blocks in one job", () => {
    const jobs = planScanJobs([ip("10.0.0.1"), ip("10.1.0.1")], [], 256);
    expect(jobs.map((job) => job.subnet)).toEqual(["10.0.0.1", "10.1.0.1"]);
  });

  it("scans an address covered by several entries once", () => {
    const jobs = planScanJobs([cidr("192.0.2.0/24"), ip("192.0.2.77"), cidr("192.0.2.0/25")], [], 256);
    expect(jobs).toEqual([{ subnet: "192.0.2.0/24", targets: ["192.0.2.0/24"], hosts: [], addressCount: 256 }]);
  });

  it("keeps every batch within the batch size", () => {
    const jobs = planScanJobs([ip("10.0.0.1"), cidr("10.0.1.0/24")], [], 256);
    expect(jobs.map((job) => job.addressCount)).toEqual([256, 1]);
    expect(jobs[0]).toMatchObject({ subnet: "10.0.0.0/23", targets: expect.arrayContaining(["10.0.0.1"]) });
  });

  it("attaches resolved domains to the batch holding their address", () => {
    const hosts = [
      { ip: "198.51.100.7", domain: "b.example.com" },
      { ip: "192.0.2.10", domain: "a.example.com" },
    ];
    const jobs = planScanJobs([ip("192.0.2.10"), ip("198.51.100.7")], hosts, 256);
    expect(jobs.map((job) => job.hosts)).toEqual([
      [{ ip: "192.0.2.10", domain: "a.example.com" }],
      [{ ip: "198.51.100.7", domain: "b.example.com" }],
    ]);
  });

  it("plans nothing for nothing", () => {
    expect(planScanJobs([], [], 256)).toEqual([]);
  });
});
