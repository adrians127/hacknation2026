import { describe, expect, it } from "vitest";

import { ipv4ToInt } from "@subsurf/contracts/targets/ipv4";
import type { ScanChangeRow } from "@subsurf/contracts/scans/scan-changes.schema";

import {
  applyChangeRules,
  compileRule,
  compileRules,
  matchesHost,
  matchesService,
  matchesVulnerability,
  serviceFacts,
  type ChangeRowFacts,
  type VulnerabilityFacts,
} from "~backend/modules/rules/rule-match";
import { definition } from "~backend/modules/rules/test/rules";

const ID = "0193f0d0-0000-7000-8000-000000000001";
const host = { ipNumber: ipv4ToInt("10.0.5.7"), tags: ["dmz"] };
const nginx = serviceFacts(443, { name: null, product: null }, { name: "https", product: "nginx" }, [
  "Wiki – login",
]);
const ssh = serviceFacts(22, { name: null, product: "Vendor SSH" }, { name: "ssh", product: "OpenSSH" });

const REF = { id: ID, name: "Rule" };
type Parts<K extends "service" | "vulnerability" | "change_priority"> = Parameters<
  typeof definition<K>
>[1];
const serviceRule = (parts: Parts<"service"> = {}) => compileRule(REF, definition("service", parts));

const hostRule = (scope: { ports?: number[] }) =>
  serviceRule({ scope, condition: { target: "host" } });

describe("scope", () => {
  it("matches ranges, host tags, ports and products, empty lists matching anything", () => {
    expect(matchesService(serviceRule(), host, nginx)).toBe(true);
    expect(matchesService(serviceRule({ scope: { ranges: ["10.0.5.0/24"] } }), host, nginx)).toBe(true);
    expect(matchesService(serviceRule({ scope: { ranges: ["10.0.6.0/24", "10.0.5.8"] } }), host, nginx)).toBe(false);
    expect(matchesService(serviceRule({ scope: { hostTags: ["prod", "dmz"] } }), host, nginx)).toBe(true);
    expect(matchesService(serviceRule({ scope: { hostTags: ["prod"] } }), host, nginx)).toBe(false);
    expect(matchesService(serviceRule({ scope: { ports: [80, 443] } }), host, nginx)).toBe(true);
    expect(matchesService(serviceRule({ scope: { ports: [80] } }), host, nginx)).toBe(false);
    expect(matchesService(serviceRule({ scope: { products: ["NGINX"] } }), host, nginx)).toBe(true);
  });

  it("reads the user's correction of the product instead of the observed one", () => {
    expect(matchesService(serviceRule({ scope: { products: ["openssh"] } }), host, ssh)).toBe(false);
    expect(matchesService(serviceRule({ scope: { products: ["vendor"] } }), host, ssh)).toBe(true);
    // The name was not corrected, so the observed one counts.
    expect(matchesService(serviceRule({ scope: { products: ["ssh"] } }), host, ssh)).toBe(true);
  });

  it("matches HTTP titles by part, ignoring case", () => {
    expect(matchesService(serviceRule({ condition: { titles: ["LOGIN"] } }), host, nginx)).toBe(true);
    expect(matchesService(serviceRule({ condition: { titles: ["admin"] } }), host, nginx)).toBe(false);
  });

  it("matches a host through any of its services only when the rule names services", () => {
    expect(matchesHost(hostRule({}), host, [])).toBe(true);
    expect(matchesHost(hostRule({ ports: [22] }), host, [nginx, ssh])).toBe(true);
    expect(matchesHost(hostRule({ ports: [3389] }), host, [nginx, ssh])).toBe(false);
  });

  it("leaves disabled and expired rules out", () => {
    const now = new Date("2026-11-22T12:00:00Z");
    const row = { id: ID, name: "Rule", definition: definition("service") };
    expect(compileRules([{ ...row, enabled: false, expiresAt: null }], now)).toHaveLength(0);
    expect(compileRules([{ ...row, enabled: true, expiresAt: now }], now)).toHaveLength(0);
    expect(compileRules([{ ...row, enabled: true, expiresAt: new Date("2026-11-23") }], now)).toHaveLength(1);
  });
});

describe("matchesVulnerability", () => {
  const terrapin: VulnerabilityFacts = {
    vulnerabilityId: "CVE-2023-48795",
    severity: "medium",
    cvssScore: 5.9,
    kev: false,
    confidence: "potential",
    reasons: ["distro_backport_possible"],
  };
  const matches = (parts: Parts<"vulnerability">) =>
    matchesVulnerability(compileRule(REF, definition("vulnerability", parts)), host, ssh, terrapin);

  it("matches ids ignoring case, severities, CVSS bounds, KEV, confidence and reasons", () => {
    expect(matches({ condition: { vulnerabilityIds: ["cve-2023-48795"] } })).toBe(true);
    expect(matches({ condition: { vulnerabilityIds: ["CVE-2024-6387"] } })).toBe(false);
    expect(matches({ condition: { severities: ["low", "medium"] } })).toBe(true);
    expect(matches({ condition: { cvssBelow: 6 } })).toBe(true);
    expect(matches({ condition: { cvssBelow: 5.9 } })).toBe(false);
    expect(matches({ condition: { cvssAtLeast: 7 } })).toBe(false);
    expect(matches({ condition: { kev: true } })).toBe(false);
    expect(matches({ condition: { confidence: "potential", reasons: ["version_unknown", "distro_backport_possible"] } })).toBe(true);
    expect(matches({ condition: { reasons: ["version_unknown"] } })).toBe(false);
  });

  it("needs a score for a CVSS bound", () => {
    const below = compileRule(REF, definition("vulnerability", { condition: { cvssBelow: 4 } }));
    expect(matchesVulnerability(below, host, ssh, { ...terrapin, cvssScore: null })).toBe(false);
  });
});

const changeRule = (id: string, parts: Parts<"change_priority">) =>
  compileRule({ id, name: id }, definition("change_priority", parts));

describe("applyChangeRules", () => {
  const row: ScanChangeRow = {
    hostId: ID,
    ip: "10.0.5.7",
    hostnames: [],
    protocol: "tcp",
    port: 443,
    change: "changed",
    field: "tls.cert",
    endpoint: null,
    key: null,
    before: "a",
    after: "b",
    priority: "medium",
    reason: "cert-change",
    rule: null,
    muted: false,
    lifecycle: { state: "active", misses: 0, flips: 0 },
  };
  const facts: ChangeRowFacts = { row, host, service: nginx };

  it("mutes or re-rates with the first matching rule, keeping the built-in reason", () => {
    const mute = changeRule("mute", { condition: { fields: ["tls.cert", "tls.expiry"] } });
    const raise = changeRule("raise", { scope: { ports: [443] }, action: { type: "priority", priority: "high" } });
    expect(applyChangeRules(facts, [mute, raise])).toMatchObject({ muted: true, priority: "medium", rule: { id: "mute" } });
    expect(applyChangeRules(facts, [raise, mute])).toMatchObject({ muted: false, priority: "high", reason: "cert-change", rule: { id: "raise" } });
  });

  it("matches row kinds, lifecycles and the built-in priority; leaves rows no rule matches", () => {
    const hostRows = changeRule("hosts", { condition: { rows: ["host"] } });
    const unstable = changeRule("unstable", { condition: { lifecycles: ["unstable"] } });
    const lowOnly = changeRule("low", { condition: { priorities: ["low"] } });
    expect(applyChangeRules(facts, [hostRows, unstable, lowOnly])).toBe(row);
    expect(applyChangeRules({ ...facts, service: null, row: { ...row, port: null, field: null } }, [hostRows]).rule?.id).toBe("hosts");
  });

  it("does not match a host-wide row when the rule names ports or products", () => {
    const ports = changeRule("ports", { scope: { ports: [443] } });
    expect(applyChangeRules({ ...facts, service: null, row: { ...row, port: null, field: null } }, [ports]).rule).toBeNull();
  });
});
