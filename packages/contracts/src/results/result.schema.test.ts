import { describe, expect, it } from "vitest";
import { z } from "zod";

import example from "./result.example.json";
import { ScanResultDocumentSchema, type ScanResultDocument } from "./result.schema";

const document = (): ScanResultDocument => ScanResultDocumentSchema.parse(structuredClone(example));

function issuePaths(value: unknown): string[] {
  const result = ScanResultDocumentSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => issue.path.join("."));
}

describe("ScanResultDocumentSchema", () => {
  it("accepts the example document", () => {
    expect(issuePaths(example)).toEqual([]);
  });

  it("rejects a host outside its subnet", () => {
    const doc = document();
    doc.subnets[0].hosts[0].ip = "203.0.113.7";
    expect(issuePaths(doc)).toContain("subnets.0.hosts.0.ip");
  });

  it("rejects a subnet written with host bits set", () => {
    const doc = document();
    doc.subnets[0].cidr = "192.0.2.1/24";
    expect(issuePaths(doc)).toContain("subnets.0.cidr");
  });

  it("rejects duplicate subnets, hosts, ports and endpoints", () => {
    const doc = document();
    const [web, cam] = doc.subnets[0].hosts;
    cam.ip = web.ip;
    web.ports.push(structuredClone(web.ports[0]));
    const https = web.ports[1];
    https.endpoints.push(structuredClone(https.endpoints[0]));
    doc.subnets.push(structuredClone(doc.subnets[1]));

    expect(issuePaths(doc)).toEqual(
      expect.arrayContaining([
        "subnets.0.hosts.1.ip",
        "subnets.0.hosts.0.ports.2",
        "subnets.0.hosts.0.ports.1.endpoints.1.hostname",
        "subnets.2.cidr",
      ]),
    );
  });

  it("allows only safe methods for probed paths", () => {
    const doc = document();
    const http = doc.subnets[0].hosts[0].ports[1].endpoints[0].http;
    if (!http) throw new Error("The example lost its HTTPS endpoint");
    Object.assign(http.paths[0], { method: "POST" });
    expect(issuePaths(doc)).toContain("subnets.0.hosts.0.ports.1.endpoints.0.http.paths.0.method");
  });

  it("converts to JSON Schema with sensitive fields marked", () => {
    const schema = JSON.stringify(z.toJSONSchema(ScanResultDocumentSchema));
    expect(schema.match(/"x-sensitive":true/g)).toHaveLength(2);
  });
});
