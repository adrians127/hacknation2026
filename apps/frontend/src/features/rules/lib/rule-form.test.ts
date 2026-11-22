import { describe, expect, it } from "vitest";

import { RuleDefinitionSchema } from "@subsurf/contracts/rules/rules.schema";

import { EMPTY_FORM, issueField, toDefinition, toFormState } from "@/features/rules/lib/rule-form";
import { RULE_PRESET_IDS, RULE_PRESETS } from "@/features/rules/lib/rule-presets";

describe("rule presets", () => {
  it.each(RULE_PRESET_IDS)("%s is a valid definition that survives the form", (id) => {
    const definition = RULE_PRESETS[id];
    expect(RuleDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(toDefinition(toFormState(definition))).toEqual(definition);
  });
});

describe("toDefinition", () => {
  it("reads lists from text and leaves empty numbers out", () => {
    const definition = toDefinition({
      ...EMPTY_FORM,
      scope: {
        ranges: "10.0.0.0/8\n192.0.2.1, ",
        hostTags: "prod, dmz",
        ports: "22 443",
        products: "Microsoft Exchange",
      },
      vulnerability: {
        ...EMPTY_FORM.vulnerability,
        ids: "CVE-2023-48795 CVE-2024-6387",
        cvssBelow: "4",
      },
    });
    expect(definition).toMatchObject({
      kind: "vulnerability",
      scope: {
        ranges: ["10.0.0.0/8", "192.0.2.1"],
        hostTags: ["prod", "dmz"],
        ports: [22, 443],
        products: ["Microsoft Exchange"],
      },
      condition: {
        vulnerabilityIds: ["CVE-2023-48795", "CVE-2024-6387"],
        cvssAtLeast: null,
        cvssBelow: 4,
      },
    });
  });

  it("points validation issues at their fields", () => {
    const result = RuleDefinitionSchema.safeParse(
      toDefinition({ ...EMPTY_FORM, scope: { ...EMPTY_FORM.scope, ports: "22 http" } }),
    );
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issueField(issue.path))).toEqual(["scope.ports"]);
  });
});
