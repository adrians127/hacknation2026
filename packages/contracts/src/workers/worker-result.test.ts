import { describe, expect, it } from "vitest";

import { buildWorkerResult } from "./worker-result.fixture";
import { WorkerResultSchema } from "./worker-result.schema";

describe("WorkerResultSchema", () => {
  it("accepts the example from docs/worker-result-format.md", () => {
    expect(WorkerResultSchema.safeParse(buildWorkerResult()).error).toBeUndefined();
  });

  it("rejects an address reported twice", () => {
    const result = buildWorkerResult();
    result.hosts.push({ ...result.hosts[1] });
    expect(WorkerResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects open ports on a host that is not up", () => {
    const result = buildWorkerResult();
    result.hosts[1].ports = result.hosts[0].ports;
    expect(WorkerResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects one (scheme, vhost) twice on a port", () => {
    const result = buildWorkerResult();
    const https = result.hosts[0].ports[1];
    https.http = [https.http[0], https.http[0]];
    expect(WorkerResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects an omitted key: every key is always present", () => {
    const { reason: _omitted, ...host } = buildWorkerResult().hosts[1];
    const result = { ...buildWorkerResult(), hosts: [host] };
    expect(WorkerResultSchema.safeParse(result).success).toBe(false);
  });

  it("rejects cookie values and uppercase hashes", () => {
    const result = buildWorkerResult();
    result.hosts[0].ports[1].http[0].cookies[0].valueSha256 = "plain-session-value";
    expect(WorkerResultSchema.safeParse(result).success).toBe(false);

    const upper = buildWorkerResult();
    upper.hosts[0].ports[0].identity.sshHostKeySha256 = "A".repeat(64);
    expect(WorkerResultSchema.safeParse(upper).success).toBe(false);
  });
});
