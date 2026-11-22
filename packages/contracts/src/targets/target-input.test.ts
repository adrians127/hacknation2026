import { describe, expect, it } from "vitest";

import {
  collectTargets,
  parseTargetJson,
  parseTargetText,
  parseTargetValue,
  splitTargetText,
} from "./target-input";
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

const blocks = (raw: string) => {
  const parsed = ok(raw);
  if (parsed.kind !== "range") throw new Error(`${raw} is not a range`);
  return parsed.blocks.map((block) => `${block.kind}:${block.value}`);
};

describe("IP ranges", () => {
  it("splits a range into the fewest CIDR blocks", () => {
    expect(ok("10.0.0.1-10.0.0.200")).toMatchObject({
      kind: "range",
      value: "10.0.0.1-10.0.0.200",
      warnings: ["range_split"],
    });
    expect(blocks("10.0.0.1-10.0.0.200")).toEqual([
      "ip:10.0.0.1",
      "cidr:10.0.0.2/31",
      "cidr:10.0.0.4/30",
      "cidr:10.0.0.8/29",
      "cidr:10.0.0.16/28",
      "cidr:10.0.0.32/27",
      "cidr:10.0.0.64/26",
      "cidr:10.0.0.128/26",
      "cidr:10.0.0.192/29",
      "ip:10.0.0.200",
    ]);
    expect(blocks("10.0.0.0-10.0.0.255")).toEqual(["cidr:10.0.0.0/24"]);
    expect(blocks("10.0.0.0-10.0.255.255")).toEqual(["cidr:10.0.0.0/16"]);
  });

  it("accepts nmap's last-octet form, spaces and an en dash", () => {
    for (const raw of ["10.0.0.1-200", "10.0.0.1 - 10.0.0.200", "10.0.0.1–10.0.0.200", "http://10.0.0.1-200/"]) {
      expect(ok(raw).value, raw).toBe("10.0.0.1-10.0.0.200");
    }
  });

  it("rejects ranges it cannot scan", () => {
    expect(rejection("10.0.0.200-10.0.0.1")).toBe("invalid_range");
    expect(rejection("10.0.0.200-1")).toBe("invalid_range");
    expect(rejection("10.0.0.0-10.1.0.0")).toBe("range_too_large");
    expect(rejection("126.255.255.0-127.0.0.5")).toBe("reserved_range");
    expect(rejection("10.0.0.1-256")).toBe("invalid_format");
    expect(rejection("10.0.0.1-10.0.0.300")).toBe("invalid_format");
  });

  it("leaves hyphenated domains alone", () => {
    expect(ok("my-host.example.com")).toMatchObject({ kind: "domain" });
  });

  it("imports a range as its blocks, each with the note", () => {
    const result = parseTargetText("192.0.2.0-192.0.2.129, Lab");
    expect(result.entries.map((entry) => [entry.kind, entry.value, entry.note, entry.position])).toEqual([
      ["cidr", "192.0.2.0/25", "Lab", 1],
      ["cidr", "192.0.2.128/31", "Lab", 1],
    ]);
    expect(result.stats).toEqual({ ip: 0, cidr: 2, domain: 0, addresses: 130 });
    expect(result.issues).toEqual([{ position: 1, raw: "192.0.2.0-192.0.2.129", code: "range_split" }]);
  });

  it("drops blocks already listed and a range that adds nothing", () => {
    const result = parseTargetText("192.0.2.128/31\n192.0.2.0-192.0.2.129\n192.0.2.0-192.0.2.129\n192.0.2.0/25");
    expect(result.entries.map((entry) => entry.value)).toEqual(["192.0.2.128/31", "192.0.2.0/25"]);
    expect(result.issues.filter((issue) => issue.code === "duplicate").map((issue) => issue.position)).toEqual([3, 4]);
  });
});

const covered = (text: string) =>
  parseTargetText(text)
    .issues.filter((issue) => issue.code === "covered_by")
    .map((issue) => [issue.position, issue.detail]);

describe("overlapping targets", () => {
  it("warns about an entry inside another one, whichever comes first", () => {
    expect(covered("10.0.0.5\n10.0.0.0/24\n10.0.0.128/25\n10.0.1.1")).toEqual([
      [1, "10.0.0.0/24"],
      [3, "10.0.0.0/24"],
    ]);
  });

  it("names the range as the user wrote it, once per pair", () => {
    expect(covered("10.0.0.1-10.0.0.200\n10.0.0.100-10.0.0.120\n10.0.0.150")).toEqual([
      [2, "10.0.0.1-10.0.0.200"],
      [3, "10.0.0.1-10.0.0.200"],
    ]);
  });

  it("keeps the overlapping entries", () => {
    const result = parseTargetText("10.0.0.0/24\n10.0.0.7, Web server");
    expect(result.entries.map((entry) => entry.value)).toEqual(["10.0.0.0/24", "10.0.0.7"]);
    expect(result.stats.addresses).toBe(256);
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
      { kind: "ip", value: "192.0.2.1", note: "gw", range: { start: 3221225985, end: 3221225985 }, position: 0 },
    ]);
    expect(result.issues).toEqual([{ position: 1, raw: "::1", code: "ipv6_unsupported" }]);
  });
});

describe("splitTargetText", () => {
  it("returns the rows with their line numbers, before any validation", () => {
    expect(splitTargetText("target,note\n\n# skip\nnot a target,x\n10.0.0.0/24")).toEqual([
      { position: 4, value: "not a target", note: "x" },
      { position: 5, value: "10.0.0.0/24", note: "" },
    ]);
  });
});

describe("ImportTargetsBodySchema", () => {
  it("accepts raw values the backend will normalize", () => {
    const body = { entries: [{ value: "10.0.0.5/24" }, { value: "10.0.0.0/24" }], startScan: true };
    expect(ImportTargetsBodySchema.safeParse(body).success).toBe(true);
  });

  it("accepts IP ranges", () => {
    expect(ImportTargetsBodySchema.safeParse({ entries: [{ value: "10.0.0.1-200" }], startScan: false }).success).toBe(
      true,
    );
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
