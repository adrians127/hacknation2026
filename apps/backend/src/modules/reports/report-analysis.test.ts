import { describe, expect, it } from "vitest";

import type { HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

import { changedFields } from "~backend/modules/reports/diff-report";
import { findingsFor } from "~backend/modules/reports/findings";
import { classify, dayPeriod } from "~backend/modules/reports/history-reports";
import type { ReportService } from "~backend/modules/reports/report-data";
import { technologiesOf } from "~backend/modules/reports/technologies";

const NOW = new Date("2026-11-22T12:00:00Z");
const SHA = "a".repeat(64);

function endpoint(overrides: Partial<HttpEndpoint> = {}): HttpEndpoint {
  return {
    scheme: "https",
    vhost: "app.example.org",
    url: "https://app.example.org/",
    finalUrl: "https://app.example.org/",
    statusCode: 200,
    title: "App",
    headers: [],
    cookies: [],
    redirects: [],
    body: { sha256: SHA, size: 10, contentType: "text/html", content: "<html></html>", truncated: false },
    favicon: null,
    tls: null,
    probes: [],
    error: null,
    ...overrides,
  };
}

function service(overrides: Partial<ReportService> = {}): ReportService {
  return {
    serviceId: "00000000-0000-7000-8000-000000000001",
    hostId: "00000000-0000-7000-8000-000000000002",
    ip: "10.0.0.1",
    port: 443,
    protocol: "tcp",
    change: null,
    present: true,
    identity: { name: "https", product: "nginx", version: "1.24.0" },
    observed: { name: "https", product: "nginx", version: "1.24.0" },
    extraInfo: null,
    cpe: [],
    details: { identity: { ttl: 64, sshHostKeySha256: null, tlsCertSha256: null }, banner: null, scripts: [], http: [] },
    fingerprint: "f",
    triage: "unreviewed",
    tags: [],
    remediation: null,
    ...overrides,
  };
}

const withHttp = (http: HttpEndpoint[]) => service({ details: { ...service().details, http } });
const upPorts = (history: readonly (string | null)[]) => history.map((status) => (status === "up" ? [22] : null));

const rules = (target: ReportService) => findingsFor(target, NOW).map((finding) => finding.rule);

describe("findingsFor", () => {
  it("flags an exposed database by service name or well-known port", () => {
    expect(rules(service({ port: 3306, identity: { name: "mysql", product: "MySQL", version: "8.0.36" } }))).toContain(
      "database-exposed",
    );
    expect(rules(service({ port: 6379, identity: { name: null, product: null, version: null } }))).toContain(
      "database-exposed",
    );
  });

  it("reads TLS dates against the report time", () => {
    const cert = {
      subjectCn: "app.example.org",
      san: [],
      issuer: "CA",
      notBefore: "2025-01-01T00:00:00Z",
      serial: "01",
      sha256: SHA,
      selfSigned: false,
      keyAlgorithm: "RSA",
      keyBits: 1024,
    };
    const expired = endpoint({ tls: { version: "TLSv1.3", cipher: "x", alpn: null, cert: { ...cert, notAfter: "2026-11-01T00:00:00Z" } } });
    const expiring = endpoint({ tls: { version: "TLSv1.1", cipher: "x", alpn: null, cert: { ...cert, notAfter: "2026-12-01T00:00:00Z" } } });

    expect(rules(withHttp([expired]))).toEqual(expect.arrayContaining(["tls-expired", "tls-weak"]));
    expect(rules(withHttp([expiring]))).toEqual(expect.arrayContaining(["tls-expiring", "tls-weak"]));
    expect(rules(withHttp([expiring]))).not.toContain("tls-expired");
  });

  it("finds staging hosts, insecure cookies and outdated software in headers", () => {
    const http = endpoint({
      headers: [
        { name: "x-environment", value: "staging" },
        { name: "x-powered-by", value: "PHP/7.4.3" },
      ],
      cookies: [
        { name: "PHPSESSID", valueSha256: SHA, secure: false, httpOnly: false, sameSite: null, domain: null, path: "/", expires: null },
      ],
    });
    const found = findingsFor(service({ details: { ...service().details, http: [http] } }), NOW);

    expect(found.map((finding) => finding.rule)).toEqual(
      expect.arrayContaining(["debug-or-staging", "cookie-insecure", "outdated-software", "version-disclosure"]),
    );
    expect(found.find((finding) => finding.rule === "cookie-insecure")?.evidence).toBe("PHPSESSID without Secure, HttpOnly");
    expect(found.find((finding) => finding.rule === "outdated-software")?.evidence).toContain("PHP 7.4.3");
  });

  it("reports one finding per rule and service", () => {
    const http = [endpoint({ title: "phpMyAdmin" }), endpoint({ vhost: null, url: "https://10.0.0.1/", title: "phpMyAdmin" })];
    const found = findingsFor(service({ details: { ...service().details, http } }), NOW);
    expect(found.filter((finding) => finding.rule === "admin-panel")).toHaveLength(1);
  });
});

describe("technologiesOf", () => {
  it("merges sources, keeps the most specific version and rates confidence", () => {
    const http = endpoint({
      headers: [{ name: "server", value: "nginx/1.24.0 (Ubuntu)" }],
      body: {
        sha256: SHA,
        size: 10,
        contentType: "text/html",
        content: '<meta name="generator" content="WordPress 6.7.1"><link href="/wp-content/a.css">',
        truncated: false,
      },
      cookies: [
        { name: "wordpress_test_cookie", valueSha256: SHA, secure: true, httpOnly: true, sameSite: null, domain: null, path: "/", expires: null },
      ],
    });
    const found = technologiesOf(service({ details: { ...service().details, http: [http] } }));
    const byName = new Map(found.map((entry) => [entry.name, entry]));

    expect(byName.get("nginx")?.instance).toMatchObject({ version: "1.24.0", confidence: "high" });
    expect(byName.get("WordPress")).toMatchObject({ category: "cms", instance: { version: "6.7.1", confidence: "high" } });
    expect(byName.get("WordPress")?.instance.sources).toEqual(["body", "cookie", "meta-generator"]);
  });

  it("rates a detection from a title alone as low confidence", () => {
    const found = technologiesOf(
      service({ identity: { name: "http", product: null, version: null }, details: { ...service().details, http: [endpoint({ title: "Grafana" })] } }),
    );
    expect(found).toEqual([expect.objectContaining({ name: "Grafana", instance: expect.objectContaining({ confidence: "low" }) })]);
  });
});

describe("classify", () => {
  it.each([
    [["up", "up", "up"], null],
    [["up", "down", "up"], "flapping"],
    [["up", "timeout"], "unresponsive"],
    [["up", "down", "down", "down"], "inactive"],
    [["up", "down"], "going-quiet"],
    [["up", null, "down", "down", "down"], "inactive"],
  ] as const)("%j is %s", (history, expected) => {
    expect(classify(history, upPorts(history), 3, false).class).toBe(expected);
  });

  it("tells a returning host from a new one", () => {
    expect(classify(["down", "up"], [null, [22]], 3, true).class).toBe("returned");
    expect(classify(["down", "up"], [null, [22]], 3, false).class).toBeNull();
  });

  it("finds ports that open and close while the host stays up", () => {
    const result = classify(["up", "up", "up"], [[22, 80], [22], [22, 80]], 3, false);
    expect(result).toMatchObject({ class: "unstable-ports", unstablePorts: [80] });
  });
});

describe("dayPeriod", () => {
  it("follows the viewer's offset", () => {
    expect(dayPeriod(new Date("2026-11-20T01:00:00Z"), 0)).toBe("night");
    expect(dayPeriod(new Date("2026-11-20T23:30:00Z"), 60)).toBe("night");
    expect(dayPeriod(new Date("2026-11-20T05:30:00Z"), 60)).toBe("morning");
    expect(dayPeriod(new Date("2026-11-20T13:00:00Z"), -120)).toBe("morning");
  });
});

describe("changedFields", () => {
  it("names what differs between two snapshots", () => {
    const before = {
      identity: { name: "http", product: "nginx", version: "1.24.0" },
      software: ["server: nginx/1.24.0"],
      http: [{ url: "http://a/", statusCode: 200, title: "A", finalUrl: "http://a/" }],
      certSha256: null,
      certNotAfter: null,
    };
    expect(
      changedFields(before, {
        ...before,
        identity: { ...before.identity, version: "1.26.0" },
        http: [{ url: "http://a/", statusCode: 503, title: "Maintenance", finalUrl: "http://a/" }],
      }),
    ).toEqual(["version", "http-status", "http-title"]);
    expect(changedFields(before, before)).toEqual(["other"]);
  });
});
