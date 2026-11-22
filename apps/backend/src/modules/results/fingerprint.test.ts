import { describe, expect, it } from "vitest";

import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";
import type { OpenPort } from "@subsurf/contracts/workers/worker-result.schema";

import { comparablePort } from "~backend/modules/results/comparable";
import { portFingerprint } from "~backend/modules/results/fingerprint";
import { fieldChanges } from "~backend/modules/scans/field-changes";

const httpsPort = (): OpenPort => buildWorkerResult().hosts[0].ports[1];

function changed(mutate: (port: OpenPort) => void): boolean {
  const port = httpsPort();
  mutate(port);
  return portFingerprint(port) !== portFingerprint(httpsPort());
}

const unchangedPage: Record<string, (port: OpenPort) => void> = {
  "a date header": (port) => port.http[0].headers.push({ name: "date", value: "Sat, 21 Nov 2026" }),
  "a cookie value": (port) => (port.http[0].cookies[0].valueSha256 = "1".repeat(64)),
  "a cookie expiry": (port) => (port.http[0].cookies[0].expires = "Sun, 22 Nov 2026 00:00:00 GMT"),
  "the body": (port) => {
    const [endpoint] = port.http;
    endpoint.body = endpoint.body && { ...endpoint.body, sha256: "2".repeat(64) };
  },
  "a session id in the URL": (port) =>
    (port.http[0].finalUrl = "https://wiki.example.org/login;jsessionid=abc?next=%2F"),
  "the endpoint order": (port) => (port.http = port.http.toReversed()),
  "the banner": (port) => (port.banner = "220 ready at 14:03:11"),
};

const changedPage: Record<string, (port: OpenPort) => void> = {
  "the version": (port) => (port.service!.version = "1.25.0"),
  "the server header": (port) => (port.http[0].headers[0].value = "nginx/1.25.0"),
  "an x-jenkins header": (port) => port.http[0].headers.push({ name: "X-Jenkins", value: "2.479" }),
  "the title": (port) => (port.http[0].title = "Wiki"),
  "the certificate": (port) => {
    const [endpoint] = port.http;
    endpoint.tls = endpoint.tls && {
      ...endpoint.tls,
      cert: { ...endpoint.tls.cert, sha256: "3".repeat(64) },
    };
  },
  "an endpoint": (port) => port.http.pop(),
  "a cookie name": (port) => (port.http[0].cookies[0].name = "JSESSIONID"),
  "a cookie flag": (port) => (port.http[0].cookies[0].httpOnly = true),
  "a probe status": (port) => (port.http[0].probes[0].statusCode = 200),
  "the SSH host key": (port) => (port.identity.sshHostKeySha256 = "4".repeat(64)),
  "a security header": (port) => {
    port.http[0].headers.push({ name: "strict-transport-security", value: "max-age=600" });
  },
  "a TLS-only certificate": (port) => {
    port.tls = [{ vhost: null, version: "tls13", cipher: "TLS_AES_128_GCM_SHA256",
      alpn: null, cert: { subjectCn: null, san: [], issuer: null, notBefore: null,
        notAfter: null, serial: null, sha256: "a".repeat(64), selfSigned: null,
        keyAlgorithm: null, keyBits: null } }];
  },
};

function withPolicy(nonce: string): OpenPort {
  const port = httpsPort();
  port.http[0].headers.push({ name: "content-security-policy", value: `script-src 'nonce-${nonce}'` });
  return port;
}

describe("portFingerprint", () => {
  it.each(Object.entries(unchangedPage))("ignores %s", (_name, mutate) => {
    expect(changed(mutate)).toBe(false);
  });

  it.each(Object.entries(changedPage))("changes with %s", (_name, mutate) => {
    expect(changed(mutate)).toBe(true);
  });

  it("ignores a security header's value", () => {
    expect(portFingerprint(withPolicy("a"))).toBe(portFingerprint(withPolicy("b")));
    expect(fieldChanges(comparablePort(withPolicy("a")), comparablePort(withPolicy("b")))).toEqual([]);
  });

  it("agrees with the field-level diff", () => {
    for (const mutate of [...Object.values(unchangedPage), ...Object.values(changedPage)]) {
      const port = httpsPort();
      mutate(port);
      const fields = fieldChanges(comparablePort(httpsPort()), comparablePort(port));
      expect(fields.length > 0).toBe(changed(mutate));
    }
  });
});
