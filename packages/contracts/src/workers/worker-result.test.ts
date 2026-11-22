import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildWorkerResult } from "./worker-result.fixture";
import { WorkerResultSchema } from "./worker-result.schema";

describe("WorkerResultSchema", () => {
  it("accepts the example from docs/worker-result-format.md", () => {
    expect(WorkerResultSchema.safeParse(buildWorkerResult()).error).toBeUndefined();
  });

  it("accepts naabu-worker's result.json example", () => {
    const path = new URL("../../../../apps/workers/naabu-worker/examples/result.json", import.meta.url);
    const result: unknown = JSON.parse(readFileSync(path, "utf8"));
    expect(WorkerResultSchema.safeParse(result).error).toBeUndefined();
  });

  it("validates a TLS-only result emitted by tlsx-worker", () => {
    const directory = mkdtempSync(join(tmpdir(), "tlsx-contract-"));
    try {
      const worker = new URL("../../../../apps/workers/tlsx-worker/tlsx-worker", import.meta.url);
      const fake = new URL("../../../../apps/workers/tlsx-worker/tests/fake_tlsx.py", import.meta.url);
      const result: unknown = JSON.parse(execFileSync("python3", [worker.pathname], {
        input: JSON.stringify({
          job_id: "0193a1f2-1b2c-7d3e-8f40-516273849506",
          scan_id: "0193a0f2-1b2c-7d3e-8f40-516273849506",
          lease_id: "lease-1",
          targets: [{ ip: "127.0.0.1", ports: [443], domains: ["local.test"] }],
          ports: [443], rate: 25, max_duration_seconds: 5,
        }),
        encoding: "utf8",
        env: { ...process.env, TLSX_BINARY: fake.pathname, FAKE_TLSX_ARGS: join(directory, "args") },
      }));
      const parsed = WorkerResultSchema.parse(result);
      expect(parsed.hosts[0].ports[0].http).toEqual([]);
      expect(parsed.hosts[0].ports[0].tls).toHaveLength(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects duplicate TLS SNI on one port", () => {
    const result = buildWorkerResult();
    const port = result.hosts[0].ports[1];
    port.tls = [{ vhost: null, version: "TLSv1.3", cipher: null, alpn: null, cert: null }];
    port.tls.push({ ...port.tls[0] });
    expect(WorkerResultSchema.safeParse(result).success).toBe(false);
  });

  it("requires the TLS field even when no TLS was probed", () => {
    const result = buildWorkerResult();
    const { tls: _omitted, ...port } = result.hosts[0].ports[0];
    const invalid = { ...result, hosts: [{ ...result.hosts[0], ports: [port] }] };
    expect(WorkerResultSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts HTTP-only worker params without an aligned subnet or Nmap timeout", () => {
    const result = buildWorkerResult();
    result.scan.worker.id = "httpx-worker";
    result.scan.worker.nmapVersion = null;
    result.scan.params.subnet = null;
    result.scan.params.hostTimeoutMs = null;
    result.scan.params.nmapArgs = [];
    expect(WorkerResultSchema.safeParse(result).error).toBeUndefined();
  });

  it("accepts discovery worker fields that do not apply or cannot be counted", () => {
    const result = buildWorkerResult();
    result.scan.worker.id = "naabu-worker";
    result.scan.worker.nmapVersion = null;
    result.scan.status = "partial";
    result.scan.stopReason = "deadline";
    result.scan.params.hostTimeoutMs = null;
    result.scan.params.httpTimeoutMs = null;
    result.scan.params.maxBodyBytes = null;
    result.scan.params.maxRedirects = null;
    result.scan.params.nmapArgs = [];
    result.scan.counts.down = null;
    result.scan.counts.cancelled = null;
    expect(WorkerResultSchema.safeParse(result).error).toBeUndefined();
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
