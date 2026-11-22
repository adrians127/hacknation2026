import { describe, expect, it } from "vitest";

import { buildWorkerResult } from "@subsurf/contracts/workers/worker-result.fixture";
import type { OpenPort } from "@subsurf/contracts/workers/worker-result.schema";

import { comparablePort } from "~backend/modules/results/comparable";
import { fieldChanges, hostnameChanges } from "~backend/modules/scans/field-changes";

const httpsPort = (): OpenPort => buildWorkerResult().hosts[0].ports[1];

function changesAfter(mutate: (port: OpenPort) => void) {
  const port = httpsPort();
  mutate(port);
  return fieldChanges(comparablePort(httpsPort()), comparablePort(port));
}

const wiki = { scheme: "https", vhost: "wiki.example.org" } as const;

describe("fieldChanges", () => {
  it("finds nothing between two requests to the same page", () => {
    expect(
      changesAfter((port) => {
        const [endpoint] = port.http;
        endpoint.headers.push({ name: "date", value: "Sat, 21 Nov 2026 14:03:11 GMT" });
        endpoint.cookies[0].valueSha256 = "1".repeat(64);
        endpoint.finalUrl = "https://wiki.example.org/login;jsessionid=abc?next=%2F";
        port.http.reverse();
      }),
    ).toEqual([]);
  });

  it("reports the service identity and the SSH host key", () => {
    expect(
      changesAfter((port) => {
        port.service = { ...port.service!, version: "1.26.0", cpe: ["cpe:/a:nginx:nginx:1.26.0"] };
        port.identity.sshHostKeySha256 = "4".repeat(64);
      }),
    ).toEqual([
      { field: "service.version", endpoint: null, key: null, before: "1.24.0", after: "1.26.0" },
      {
        field: "service.cpe",
        endpoint: null,
        key: null,
        before: "cpe:/a:nginx:nginx:1.24.0",
        after: "cpe:/a:nginx:nginx:1.26.0",
      },
      { field: "ssh.hostKey", endpoint: null, key: null, before: null, after: "4".repeat(64) },
    ]);
  });

  it("reports the page: status, title, redirect, headers and probes", () => {
    const changes = changesAfter((port) => {
      const [endpoint] = port.http;
      endpoint.statusCode = 503;
      endpoint.title = "Maintenance";
      endpoint.finalUrl = "https://wiki.example.org/";
      endpoint.headers = [
        { name: "Server", value: "nginx/1.26.0" },
        { name: "X-Jenkins", value: "2.479" },
        { name: "Strict-Transport-Security", value: "max-age=31536000" },
      ];
      endpoint.probes[0] = { ...endpoint.probes[0], statusCode: 200 };
    });

    expect(changes).toEqual([
      { field: "http.status", endpoint: wiki, key: null, before: "200", after: "503" },
      { field: "http.title", endpoint: wiki, key: null, before: "Wiki – login", after: "Maintenance" },
      { field: "http.redirect", endpoint: wiki, key: null, before: "/login", after: "/" },
      { field: "http.header", endpoint: wiki, key: "server", before: "nginx/1.24.0", after: "nginx/1.26.0" },
      { field: "http.header", endpoint: wiki, key: "x-jenkins", before: null, after: "2.479" },
      { field: "http.header", endpoint: wiki, key: "x-powered-by", before: "PHP/8.1.2", after: null },
      {
        field: "http.securityHeader",
        endpoint: wiki,
        key: "strict-transport-security",
        before: null,
        after: "max-age=31536000",
      },
      { field: "http.probe", endpoint: wiki, key: "/wp-admin/", before: "302", after: "200" },
    ]);
  });

  it("reports cookies that appeared, went or changed their flags", () => {
    expect(
      changesAfter((port) => {
        const [endpoint] = port.http;
        const [session] = endpoint.cookies;
        endpoint.cookies = [
          { ...session, httpOnly: true, sameSite: "Lax" },
          { ...session, name: "csrftoken" },
        ];
      }),
    ).toEqual([
      { field: "http.cookie", endpoint: wiki, key: "csrftoken", before: null, after: "Secure" },
      {
        field: "http.cookieFlags",
        endpoint: wiki,
        key: "PHPSESSID",
        before: "Secure",
        after: "Secure, HttpOnly, SameSite=Lax",
      },
    ]);
  });

  it("reports a replaced certificate with what changed about it", () => {
    const changes = changesAfter((port) => {
      const [endpoint] = port.http;
      // The fixture shares one TLS object between its endpoints: replace, do not mutate.
      const tls = endpoint.tls!;
      endpoint.tls = {
        ...tls,
        version: "TLSv1.2",
        cert: {
          ...tls.cert,
          sha256: "5".repeat(64),
          issuer: "wiki.example.org",
          notAfter: "2028-01-01T00:00:00Z",
          selfSigned: true,
        },
      };
    });

    expect(changes.map((change) => [change.field, change.after])).toEqual([
      ["tls.cert", "5".repeat(64)],
      ["tls.issuer", "wiki.example.org"],
      ["tls.expiry", "2028-01-01"],
      ["tls.selfSigned", "true"],
      ["tls.version", "TLSv1.2"],
    ]);
  });

  it("reports endpoints that appeared or went, without their details", () => {
    expect(
      changesAfter((port) => {
        port.http = port.http.filter((endpoint) => endpoint.vhost !== null);
      }),
    ).toEqual([
      {
        field: "http.endpoint",
        endpoint: { scheme: "https", vhost: null },
        key: null,
        before: "https://10.0.5.7/",
        after: null,
      },
    ]);
  });
});

describe("hostnameChanges", () => {
  it("lists names that went and names that appeared, by name", () => {
    expect(hostnameChanges(["wiki.example.org", "web01.example.org"], ["web01.example.org", "docs.example.org"])).toEqual([
      { field: "host.hostname", endpoint: null, key: null, before: null, after: "docs.example.org" },
      { field: "host.hostname", endpoint: null, key: null, before: "wiki.example.org", after: null },
    ]);
  });
});
