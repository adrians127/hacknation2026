import { describe, expect, it } from "vitest";

import { ipv4ToInt } from "@subsurf/contracts/targets/ipv4";

import type { HostTarget } from "~backend/modules/rules/rule-context";
import { compileRule, serviceFacts } from "~backend/modules/rules/rule-match";
import { planRules, planTags, settle, wanted, type RuleData } from "~backend/modules/rules/rule-plan";
import { definition } from "~backend/modules/rules/test/rules";

const A = "0193f0d0-0000-7000-8000-00000000000a";
const B = "0193f0d0-0000-7000-8000-00000000000b";
const HOST = "0193f0d0-0000-7000-8000-0000000000f0";
const SERVICE = "0193f0d0-0000-7000-8000-0000000000f1";

describe("settle", () => {
  it("never touches a value a user set", () => {
    const slot = { value: "important" as const, ruleId: null };
    expect(settle(slot, { ruleId: A, value: "reviewed" }, "unreviewed")).toBeNull();
    expect(settle(slot, null, "unreviewed")).toBeNull();
  });

  it("sets unreviewed and rule-owned values, and reverts them when no rule matches", () => {
    const want = { ruleId: A, value: "reviewed" as const };
    expect(settle({ value: "unreviewed", ruleId: null }, want, "unreviewed")).toEqual({ value: "reviewed", ruleId: A });
    expect(settle({ value: "important", ruleId: B }, want, "unreviewed")).toEqual({ value: "reviewed", ruleId: A });
    expect(settle({ value: "reviewed", ruleId: A }, want, "unreviewed")).toBeNull();
    expect(settle({ value: "reviewed", ruleId: A }, null, "unreviewed")).toEqual({ value: "unreviewed", ruleId: null });
    expect(settle({ value: "reviewed", ruleId: A }, "keep", "unreviewed")).toBeNull();
  });
});

const valueOf = () => "reviewed" as const;

describe("wanted", () => {
  const rules = [compileRule({ id: A, name: "A" }, definition("unchanged")), compileRule({ id: B, name: "B" }, definition("service"))];

  it("takes the first matching rule", () => {
    expect(wanted(rules, () => "match", valueOf, null)).toEqual({ ruleId: A, value: "reviewed" });
    expect(wanted(rules, (rule) => (rule.ref.id === A ? "miss" : "match"), valueOf, null)).toEqual({ ruleId: B, value: "reviewed" });
  });

  it("keeps what an earlier rule set while it has no answer, without letting later rules take it", () => {
    const verdict = (rule: (typeof rules)[number]) => (rule.ref.id === A ? "unknown" : "match");
    expect(wanted(rules, verdict, valueOf, A)).toBe("keep");
    expect(wanted(rules, verdict, valueOf, null)).toEqual({ ruleId: B, value: "reviewed" });
  });
});

describe("planTags", () => {
  const tagRule = compileRule({ id: A, name: "A" }, definition("service", { action: { triage: null, tag: "web" } }));
  const target = (tags: string[]) => ({ kind: "service" as const, id: SERVICE, tags });
  const row = { id: "row", ruleId: A, targetKind: "service" as const, targetId: SERVICE, tag: "web" };

  it("adds the tag once and records it as the rule's", () => {
    expect(planTags(target(["x"]), [tagRule], []).write).toMatchObject({ after: ["x", "web"], add: [{ ruleId: A, tag: "web" }] });
    expect(planTags(target(["x", "web"]), [tagRule], [row])).toEqual({ write: null, drop: [] });
  });

  it("does not add it again after a user removed it, nor claim a tag the user set", () => {
    expect(planTags(target([]), [tagRule], [row])).toEqual({ write: null, drop: [] });
    expect(planTags(target(["web"]), [tagRule], [])).toEqual({ write: null, drop: [] });
  });

  it("removes its tag when the rule no longer matches", () => {
    expect(planTags(target(["web", "x"]), [], [row])).toEqual({
      write: { kind: "service", id: SERVICE, before: ["web", "x"], after: ["x"], add: [], drop: ["row"] },
      drop: [],
    });
    expect(planTags(target(["x"]), [], [row])).toEqual({ write: null, drop: ["row"] });
  });
});

const host = (triage: HostTarget["services"][number]["triage"]): HostTarget => ({
  id: HOST,
  ip: "10.0.5.7",
  triage: { value: "unreviewed", ruleId: null },
  tags: [],
  facts: { ipNumber: ipv4ToInt("10.0.5.7"), tags: [] },
  services: [
    {
      id: SERVICE,
      hostId: HOST,
      port: 443,
      triage,
      tags: [],
      facts: serviceFacts(443, { name: null, product: null }, { name: "https", product: "nginx" }),
    },
  ],
});
const data = (
  changes: ("unchanged" | "changed")[],
  triage: HostTarget["triage"] = { value: "unreviewed", ruleId: null },
): RuleData => ({
  hosts: [host(triage)],
  vulnerabilities: [],
  ruleTags: [],
  history: {
    hosts: changes.map((change) => new Map([[HOST, change]])),
    services: changes.map((change) => new Map([[SERVICE, change]])),
  },
});
describe("planRules", () => {
  const twoScans = compileRule({ id: A, name: "A" }, definition("unchanged", { condition: { scans: 2 } }));

  it("marks a service unchanged in each of the rule's scans", () => {
    expect(planRules([twoScans], data(["unchanged", "unchanged"])).serviceTriage).toEqual([
      { id: SERVICE, from: { value: "unreviewed", ruleId: null }, to: { value: "reviewed", ruleId: A } },
    ]);
    expect(planRules([twoScans], data(["unchanged"])).serviceTriage).toEqual([]);
  });

  it("sends it back to unreviewed once it changes", () => {
    const owned = { value: "reviewed" as const, ruleId: A };
    expect(planRules([twoScans], data(["changed", "unchanged"], owned)).serviceTriage).toEqual([
      { id: SERVICE, from: owned, to: { value: "unreviewed", ruleId: null } },
    ]);
  });
});
