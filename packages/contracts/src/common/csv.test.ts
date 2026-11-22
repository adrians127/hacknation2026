import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("reads quoted cells with delimiters, line breaks and doubled quotes", () => {
    expect(parseCsv('ip,note\r\n10.0.0.1,"first line\nsecond, with ""quotes"""\r\n')).toEqual([
      ["ip", "note"],
      ["10.0.0.1", 'first line\nsecond, with "quotes"'],
    ]);
  });

  it("takes the delimiter of the first line, and drops a BOM and blank lines", () => {
    expect(parseCsv("﻿ip;port\n\n10.0.0.1;22\n;\n10.0.0.2;80")).toEqual([
      ["ip", "port"],
      ["10.0.0.1", "22"],
      ["10.0.0.2", "80"],
    ]);
    expect(parseCsv("ip\tnote\n10.0.0.1\ta, b")).toEqual([
      ["ip", "note"],
      ["10.0.0.1", "a, b"],
    ]);
    expect(parseCsv("")).toEqual([]);
  });

  it("keeps empty cells in place", () => {
    expect(parseCsv("a,b,c\n1,,3\n,,x")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
      ["", "", "x"],
    ]);
  });
});
