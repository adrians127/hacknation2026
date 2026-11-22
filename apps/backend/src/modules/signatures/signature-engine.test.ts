import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import type { SignatureDefinition } from "@subsurf/contracts/signatures/signatures.schema";
import type { HttpEndpoint } from "@subsurf/contracts/workers/worker-result.schema";

import { BUILT_IN_SIGNATURES } from "~backend/modules/signatures/builtin-signatures";
import {
  BODY_SEARCH_LIMIT,
  assertValidPatterns,
  compileSignature,
  evaluateService,
  evaluateSignature,
  sourceConfidence,
  type SignatureInput,
  type SignatureMeta,
} from "~backend/modules/signatures/signature-engine";

const SHA = "a".repeat(64);

function endpoint(overrides: Partial<HttpEndpoint> = {}): HttpEndpoint {
  return {
    scheme: "https",
    vhost: null,
    url: "https://10.0.0.1/",
    finalUrl: "https://10.0.0.1/",
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

function input(overrides: Partial<SignatureInput> = {}): SignatureInput {
  return {
    port: 443,
    service: { name: "https", product: "nginx", version: "1.24.0", extraInfo: null, cpe: [] },
    banner: null,
    http: [endpoint()],
    ...overrides,
  };
}

const META: SignatureMeta = {
  id: "00000000-0000-7000-8000-000000000001",
  key: null,
  name: "Test",
  category: "other",
  product: null,
  severity: null,
  confidence: "low",
};

const run = (definition: SignatureDefinition, target: SignatureInput = input(), meta = META) =>
  evaluateSignature(compileSignature(meta, definition), target);

const cookie = (name: string) => ({
  name,
  valueSha256: SHA,
  secure: true,
  httpOnly: true,
  sameSite: null,
  domain: null,
  path: "/",
  expires: null,
});

const adminTitle = (caseSensitive: boolean): SignatureDefinition => ({
  match: "all",
  conditions: [{ target: "title", value: { op: "equals", value: "admin", caseSensitive } }],
});

const grafana = (match: "all" | "any"): SignatureDefinition => ({
  match,
  conditions: [
    { target: "title", value: { op: "equals", value: "grafana" } },
    { target: "cookie", name: { op: "equals", value: "grafana_session" } },
  ],
});

const adminProbe = (status: number[]): SignatureDefinition => ({
  match: "all",
  conditions: [{ target: "probe", path: "/admin/", status }],
});

describe("evaluateSignature", () => {
  it("matches a header's presence and its value, ignoring case", () => {
    const http = [endpoint({ headers: [{ name: "X-Environment", value: "Staging-2" }] })];
    expect(run({ match: "all", conditions: [{ target: "header", name: { op: "equals", value: "x-environment" } }] }, input({ http }))).not.toBeNull();
    const detection = run(
      {
        match: "all",
        conditions: [
          { target: "header", name: { op: "equals", value: "x-environment" }, value: { op: "contains", value: "staging" } },
        ],
      },
      input({ http }),
    );
    expect(detection?.evidence).toEqual([
      { target: "header", url: "https://10.0.0.1/", key: "x-environment", value: "Staging-2" },
    ]);
    expect(detection?.confidence).toBe("medium");
  });

  it("honours caseSensitive", () => {
    const http = [endpoint({ title: "Admin" })];
    expect(run(adminTitle(false), input({ http }))).not.toBeNull();
    expect(run(adminTitle(true), input({ http }))).toBeNull();
  });

  it("reads only cookie names", () => {
    const http = [endpoint({ cookies: [cookie("wordpress_test_cookie")] })];
    const detection = run(
      { match: "any", conditions: [{ target: "cookie", name: { op: "prefix", value: "wordpress_" } }] },
      input({ http }),
    );
    expect(detection?.sources).toEqual(["cookie"]);
    expect(detection?.confidence).toBe("low");
  });

  it("takes the version from the page with the version pattern", () => {
    const content = `<footer>Proudly powered by WordPress 6.4.2 &middot; theme</footer>`;
    const http = [endpoint({ body: { sha256: SHA, size: 1, contentType: "text/html", content, truncated: false } })];
    const detection = run(
      {
        match: "all",
        conditions: [
          { target: "body", value: { op: "contains", value: "powered by wordpress" }, version: String.raw`WordPress (\d[\d.]*)` },
        ],
      },
      input({ http }),
    );
    expect(detection?.version).toBe("6.4.2");
    expect(detection?.evidence[0]?.value).toContain("Proudly powered by WordPress 6.4.2");
  });

  it("with all, needs every HTTP condition on the same endpoint", () => {
    const http = [
      endpoint({ title: "Grafana" }),
      endpoint({ url: "https://10.0.0.1:8443/", cookies: [cookie("grafana_session")] }),
    ];
    expect(run(grafana("all"), input({ http }))).toBeNull();
    const any = run(grafana("any"), input({ http }));
    expect(any?.sources).toEqual(["cookie", "title"]);
    expect(any?.confidence).toBe("high");
  });

  it("treats port conditions as a filter, also with any", () => {
    const definition: SignatureDefinition = {
      match: "any",
      conditions: [
        { target: "port", ports: [8080] },
        { target: "service", field: "product", value: { op: "equals", value: "nginx" } },
      ],
    };
    expect(run(definition, input({ port: 443 }))).toBeNull();
    expect(run(definition, input({ port: 8080 }))?.sources).toEqual(["service"]);
  });

  it("matches a probe by path and status, never the body of the probe", () => {
    const http = [
      endpoint({
        probes: [{ path: "/admin/", statusCode: 401, location: null, title: "Login", size: 1, bodySha256: null, error: null }],
      }),
    ];
    expect(run(adminProbe([200, 401]), input({ http }))?.evidence[0]).toMatchObject({ key: "/admin/", value: "401 Login" });
    expect(run(adminProbe([200]), input({ http }))).toBeNull();
  });

  it("matches a favicon hash and a banner", () => {
    const http = [endpoint({ favicon: { url: "https://10.0.0.1/favicon.ico", mmh3: -1137954245, sha256: SHA } })];
    expect(
      run({ match: "all", conditions: [{ target: "favicon", mmh3: [1, -1137954245] }] }, input({ http }))?.confidence,
    ).toBe("medium");
    const ssh = input({ port: 22, banner: "SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13", http: [] });
    const detection = run(
      {
        match: "all",
        conditions: [{ target: "banner", value: { op: "prefix", value: "ssh-2.0-openssh" }, version: String.raw`OpenSSH_([\w.]+)` }],
      },
      ssh,
    );
    expect(detection?.version).toBe("9.6p1");
  });

  it("never rates below the signature's own confidence", () => {
    const detection = run(
      { match: "all", conditions: [{ target: "title", value: { op: "equals", value: "app" } }] },
      input(),
      { ...META, confidence: "high" },
    );
    expect(detection?.confidence).toBe("high");
  });

  it("searches only the start of a huge page and cuts the evidence short", () => {
    const content = `${"x".repeat(BODY_SEARCH_LIMIT)}needle`;
    const http = [endpoint({ body: { sha256: SHA, size: 1, contentType: "text/html", content, truncated: false } })];
    const definition: SignatureDefinition = { match: "all", conditions: [{ target: "body", value: { op: "contains", value: "needle" } }] };
    expect(run(definition, input({ http }))).toBeNull();
    const found = run(
      { match: "all", conditions: [{ target: "body", value: { op: "regex", value: "x+" } }] },
      input({ http }),
    );
    expect(found?.evidence[0]?.value.length).toBeLessThanOrEqual(160);
  });

  it("runs a catastrophic pattern in linear time", () => {
    const content = `${"a".repeat(100_000)}!`;
    const http = [endpoint({ body: { sha256: SHA, size: 1, contentType: "text/html", content, truncated: false } })];
    const started = performance.now();
    run({ match: "all", conditions: [{ target: "body", value: { op: "regex", value: "(a+)+$" } }] }, input({ http }));
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

const titleRegex = (value: string, version?: string): SignatureDefinition => ({
  match: "all",
  conditions: [{ target: "title", value: { op: "regex", value }, ...(version && { version }) }],
});

function thrown(work: () => void): unknown {
  try {
    work();
    return null;
  } catch (error) {
    return error;
  }
}

describe("assertValidPatterns", () => {

  it("refuses what RE2 cannot run in linear time, with the condition's path", () => {
    expect(() => assertValidPatterns(titleRegex("(?=admin)a"))).toThrow(ZodError);
    expect(() => assertValidPatterns(titleRegex(String.raw`(a)\1`))).toThrow(ZodError);
    const error = thrown(() => assertValidPatterns(titleRegex("ok", "no group")));
    expect(error instanceof ZodError && error.issues[0]?.path).toEqual(["definition", "conditions", 0, "version"]);
  });

  it("accepts plain RE2", () => {
    expect(() => assertValidPatterns(titleRegex("^admin$", String.raw`v(\d+)`))).not.toThrow();
  });
});

describe("sourceConfidence", () => {
  it("rates two kinds of evidence high and an explicit one medium", () => {
    expect(sourceConfidence(["title", "cookie"])).toBe("high");
    expect(sourceConfidence(["header"])).toBe("medium");
    expect(sourceConfidence(["title"])).toBe("low");
  });
});

describe("built-in signatures", () => {
  const compiled = BUILT_IN_SIGNATURES.map((builtIn) =>
    compileSignature({ ...META, ...builtIn, id: builtIn.key }, builtIn.definition),
  );

  it("all compile, with unique keys and names", () => {
    expect(compiled).toHaveLength(BUILT_IN_SIGNATURES.length);
    expect(new Set(BUILT_IN_SIGNATURES.map((builtIn) => builtIn.key)).size).toBe(BUILT_IN_SIGNATURES.length);
    expect(new Set(BUILT_IN_SIGNATURES.map((builtIn) => builtIn.name)).size).toBe(BUILT_IN_SIGNATURES.length);
  });

  it("flag a staging WordPress", () => {
    const http = [
      endpoint({
        title: "[STAGING] Blog",
        headers: [{ name: "x-environment", value: "staging" }],
        cookies: [cookie("wordpress_test_cookie")],
      }),
    ];
    const keys = evaluateService(compiled, input({ http })).map((detection) => detection.signature.id);
    expect(keys).toEqual(expect.arrayContaining(["wordpress", "staging-title", "environment-header"]));
  });
});
