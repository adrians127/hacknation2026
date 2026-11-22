import { describe, expect, it } from "vitest";

import { SignatureDefinitionSchema, type Signature } from "@subsurf/contracts/signatures/signatures.schema";

import {
  emptyCondition,
  issueCondition,
  toDefinition,
  toFormState,
  type SignatureFormState,
} from "@/features/signatures/lib/signature-form";

const signature: Signature = {
  id: "00000000-0000-7000-8000-000000000001",
  key: null,
  builtIn: false,
  name: "Staging WordPress",
  description: "",
  category: "staging",
  product: null,
  severity: "high",
  confidence: "medium",
  enabled: true,
  definition: {
    match: "all",
    conditions: [
      { target: "header", name: { op: "equals", value: "x-environment" }, value: { op: "contains", value: "staging" } },
      { target: "body", value: { op: "regex", value: "wp-content", caseSensitive: true }, version: String.raw`WordPress (\d[\d.]*)` },
      { target: "probe", path: "/wp-login.php", status: [200, 302] },
      { target: "favicon", mmh3: [-1137954245] },
      { target: "port", ports: [80, 443] },
    ],
  },
  hits: null,
  createdBy: null,
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
};

describe("signature form", () => {
  it("turns a definition into form state and back unchanged", () => {
    expect(SignatureDefinitionSchema.parse(toDefinition(toFormState(signature)))).toEqual(signature.definition);
  });

  it("drops an empty header value and probe title, and lowercases header names", () => {
    const form: SignatureFormState = {
      ...toFormState(signature),
      match: "any",
      conditions: [
        { ...emptyCondition("header"), name: { op: "equals", value: "X-Debug", caseSensitive: false } },
        { ...emptyCondition("probe"), path: " /admin/ ", status: "200, 401" },
      ],
    };
    expect(toDefinition(form)).toEqual({
      match: "any",
      conditions: [
        { target: "header", name: { op: "equals", value: "x-debug" } },
        { target: "probe", path: "/admin/", status: [200, 401] },
      ],
    });
  });

  it("lets the schema refuse a list with something that is not a number", () => {
    const form: SignatureFormState = {
      ...toFormState(signature),
      conditions: [{ ...emptyCondition("favicon"), mmh3: "123, abc" }],
    };
    const parsed = SignatureDefinitionSchema.safeParse(toDefinition(form));
    expect(parsed.success).toBe(false);
    expect(parsed.success || issueCondition(parsed.error.issues[0]?.path ?? [])).toBe(0);
  });
});
