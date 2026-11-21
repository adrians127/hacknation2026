import { describe, expect, it } from "vitest";

import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";
import type { OpenPort } from "@subsurf/contracts/workers/worker-result.schema";

import { portFingerprint } from "~backend/modules/results/fingerprint";

const httpsPort = (): OpenPort => buildWorkerResult().hosts[0].ports[1];

function changed(mutate: (port: OpenPort) => void): boolean {
  const port = httpsPort();
  mutate(port);
  return portFingerprint(port) !== portFingerprint(httpsPort());
}

describe("portFingerprint", () => {
  it("ignores what differs between two requests to the same page", () => {
    expect(
      changed((port) => {
        const endpoint = port.http[0];
        endpoint.headers.push({ name: "date", value: "Sat, 21 Nov 2026 14:03:11 GMT" });
        endpoint.cookies[0].valueSha256 = "1".repeat(64);
        endpoint.body = endpoint.body && { ...endpoint.body, sha256: "2".repeat(64) };
        endpoint.finalUrl = "https://wiki.example.org/login;jsessionid=abc?next=%2F";
        port.http.reverse();
      }),
    ).toBe(false);
  });

  it("changes with the software, the page or the certificate", () => {
    expect(changed((port) => (port.service!.version = "1.25.0"))).toBe(true);
    expect(changed((port) => (port.http[0].headers[0].value = "nginx/1.25.0"))).toBe(true);
    expect(changed((port) => (port.http[0].title = "Wiki"))).toBe(true);
    expect(changed((port) => (port.http[0].tls!.cert.sha256 = "3".repeat(64)))).toBe(true);
    expect(changed((port) => port.http.pop())).toBe(true);
  });
});
