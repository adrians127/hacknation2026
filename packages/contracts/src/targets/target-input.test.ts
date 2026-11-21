import { describe, expect, it } from "vitest";

import { collectTargets, parseTargetJson, parseTargetText, parseTargetValue } from "./target-input";
import { ImportTargetsBodySchema } from "./targets.schema";

const ok = (raw: string) => {
  const parsed = parseTargetValue(raw);
  if (!parsed.ok) throw new Error(`${raw} rejected: ${parsed.code}`);
  return parsed;
};
const rejection = (raw: string) => {
  const parsed = parseTargetValue(raw);
  return parsed.ok ? null : parsed.code;
};

describe("parseTargetValue", () => {
  it("classifies addresses, ranges and domains", () => {
    expect(ok(" 192.0.2.10 ")).toMatchObject({ kind: "ip", value: "192.0.2.10", warnings: [] });
    expect(ok("10.20.0.0/16")).toMatchObject({ kind: "cidr", value: "10.20.0.0/16", warnings: [] });
    expect(ok("App.Example.COM.")).toMatchObject({ kind: "domain", value: "app.example.com", range: null });
  });

  it("normalizes with a warning", () => {
    expect(ok("10.0.0.5/24")).toMatchObject({ value: "10.0.0.0/24", warnings: ["cidr_normalized"] });
    expect(ok("10.0.0.5/32")).toMatchObject({ kind: "ip", value: "10.0.0.5", warnings: ["single_host_cidr"] });
    expect(ok("https://Example.com:8443/admin")).toMatchObject({
      kind: "domain",
      value: "example.com",
      warnings: ["url_stripped"],
    });
    expect(ok("http://192.0.2.1/")).toMatchObject({ kind: "ip", value: "192.0.2.1" });
  });

  it("rejects what cannot be scanned", () => {
    expect(rejection("10.0.0.0/15")).toBe("cidr_too_large");
    expect(rejection("127.0.0.1")).toBe("reserved_range");
    expect(rejection("224.0.0.0/24")).toBe("reserved_range");
    expect(rejection("0.0.0.0/16")).toBe("reserved_range");
    expect(rejection("2001:db8::1")).toBe("ipv6_unsupported");
    expect(rejection("2001:db8::/64")).toBe("ipv6_unsupported");
    expect(rejection("http://[::1]/")).toBe("ipv6_unsupported");
    expect(rejection(`${"a".repeat(250)}.com`)).toBe("value_too_long");
  });

  it("rejects malformed input", () => {
    for (const raw of ["", "localhost", "10.0.0.256", "10.0.0", "10.0.0.0/33", "a_b.example.com", "*.example.com"]) {
      expect(rejection(raw), raw).toBe("invalid_format");
    }
  });
});

describe("parseTargetText", () => {
  it("reads one target per line with an optional note, skipping comments and blanks", () => {
    const result = parseTargetText("# campus\n10.0.0.0/24, Campus network\n\n192.0.2.10\nexample.com;Main site\n");
    expect(result.entries.map((entry) => [entry.value, entry.note])).toEqual([
      ["10.0.0.0/24", "Campus network"],
      ["192.0.2.10", ""],
    ]);
    // The separator is detected once (","), so a later ";" stays part of the value.
    expect(result.issues).toEqual([{ position: 5, raw: "example.com;Main site", code: "invalid_format" }]);
  });

  it("uses a header row to pick the value and note columns", () => {
    const result = parseTargetText('id;note;address\n1;"Lab; first floor";192.0.2.1\n2;;198.51.100.0/24');
    expect(result.entries.map((entry) => [entry.value, entry.note])).toEqual([
      ["192.0.2.1", "Lab; first floor"],
      ["198.51.100.0/24", ""],
    ]);
  });

  it("does not take a data row for a header", () => {
    expect(parseTargetText("192.0.2.1,host\n192.0.2.2,web").entries.map((entry) => entry.note)).toEqual([
      "host",
      "web",
    ]);
  });

  it("handles tabs, quotes and escaped quotes", () => {
    const result = parseTargetText('192.0.2.1\t"say ""hi"""\n192.0.2.2\tplain');
    expect(result.entries.map((entry) => entry.note)).toEqual(['say "hi"', "plain"]);
  });

  it("reports duplicates after normalization and keeps the first", () => {
    const result = parseTargetText("10.0.0.0/24\n10.0.0.9/24\n10.0.0.0/24");
    expect(result.entries).toHaveLength(1);
    expect(result.issues.map((issue) => [issue.position, issue.code])).toEqual([
      [2, "duplicate"],
      [3, "duplicate"],
    ]);
  });

  it("counts unique addresses across overlapping entries", () => {
    const result = parseTargetText("10.0.0.0/24\n10.0.0.7\n10.0.1.0/24\nexample.com");
    expect(result.stats).toEqual({ ip: 1, cidr: 2, domain: 1, addresses: 512 });
    expect(result.listErrors).toEqual([]);
  });

  it("flags list-level limits", () => {
    expect(parseTargetText("# nothing here\n").listErrors).toEqual(["empty"]);
    const tooManyAddresses = Array.from({ length: 17 }, (_, index) => `10.${index}.0.0/16`).join("\n");
    expect(parseTargetText(tooManyAddresses).listErrors).toEqual(["too_many_addresses"]);
    const tooManyDomains = Array.from({ length: 1001 }, (_, index) => `host${index}.example.com`).join("\n");
    expect(parseTargetText(tooManyDomains).listErrors).toEqual(["too_many_domains"]);
  });

  it("rejects an overlong note", () => {
    expect(parseTargetText(`192.0.2.1,${"x".repeat(501)}`).issues[0]?.code).toBe("note_too_long");
  });
});

const jsonValues = (text: string) => parseTargetJson(text).entries.map((entry) => [entry.value, entry.note]);

describe("parseTargetJson", () => {
  it("accepts strings, objects and a targets wrapper", () => {
    expect(jsonValues('["192.0.2.1", "example.com"]')).toEqual([
      ["192.0.2.1", ""],
      ["example.com", ""],
    ]);
    expect(jsonValues('{"targets": [{"target": "192.0.2.1", "note": "gw"}, {"address": "10.0.0.0/24"}]}')).toEqual([
      ["192.0.2.1", "gw"],
      ["10.0.0.0/24", ""],
    ]);
  });

  it("reports unusable items by position", () => {
    const result = parseTargetJson('["192.0.2.1", 42, {"name": "x"}, "nope"]');
    expect(result.entries).toHaveLength(1);
    expect(result.issues.map((issue) => [issue.position, issue.code, issue.raw])).toEqual([
      [2, "invalid_format", "42"],
      [3, "invalid_format", '{"name":"x"}'],
      [4, "invalid_format", "nope"],
    ]);
  });

  it("rejects invalid JSON and unknown shapes", () => {
    expect(parseTargetJson("[1,").listErrors).toEqual(["invalid_json"]);
    expect(parseTargetJson('{"hosts": []}').listErrors).toEqual(["unsupported_json_shape"]);
  });
});

describe("collectTargets", () => {
  it("is the same pipeline for every source", () => {
    const rows = [
      { position: 0, value: "192.0.2.1", note: " gw " },
      { position: 1, value: "::1", note: "" },
    ];
    const result = collectTargets(rows);
    expect(result.entries).toEqual([
      { kind: "ip", value: "192.0.2.1", note: "gw", range: { start: 3221225985, end: 3221225985 } },
    ]);
    expect(result.issues).toEqual([{ position: 1, raw: "::1", code: "ipv6_unsupported" }]);
  });
});

describe("ImportTargetsBodySchema", () => {
  it("accepts raw values the backend will normalize", () => {
    const body = { entries: [{ value: "10.0.0.5/24" }, { value: "10.0.0.0/24" }], startScan: true };
    expect(ImportTargetsBodySchema.safeParse(body).success).toBe(true);
  });

  it("rejects entries the parser rejects, pointing at them", () => {
    const parsed = ImportTargetsBodySchema.safeParse({
      entries: [{ value: "192.0.2.1" }, { value: "127.0.0.1" }],
      startScan: false,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [["entries", 1], "reserved_range"],
    ]);
  });
});
