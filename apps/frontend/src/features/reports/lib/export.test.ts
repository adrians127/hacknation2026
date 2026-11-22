import { describe, expect, it } from "vitest";

import { csvCell, reportFileName, toCsv } from "@/features/reports/lib/export";

describe("csv export", () => {
  it("quotes separators and quotes, and leaves empty values empty", () => {
    expect(toCsv({ columns: ["a", "b"], rows: [["x,y", 'say "hi"'], [null, 3]] })).toBe('a,b\r\n"x,y","say ""hi"""\r\n,3');
  });

  it("defuses cells a spreadsheet would run as formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell(-1)).toBe("-1");
  });

  it("names files after the report and the scan day", () => {
    expect(reportFileName("findings", "2026-11-21T01:00:00.000Z")).toBe("subsurf-findings-2026-11-21");
    expect(reportFileName("stability", null)).toBe("subsurf-stability");
  });
});
