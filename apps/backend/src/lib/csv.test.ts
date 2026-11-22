import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "~backend/lib/csv";

describe("csv", () => {
  it("quotes separators, quotes and line breaks", () => {
    expect(csvCell('Wiki, "login"')).toBe('"Wiki, ""login"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(443)).toBe("443");
  });

  it("defuses cells a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe("'-5");
  });

  it("joins rows with CRLF", () => {
    expect(toCsv(["ip", "port"], [["10.0.0.1", 22]])).toBe("ip,port\r\n10.0.0.1,22\r\n");
  });
});
