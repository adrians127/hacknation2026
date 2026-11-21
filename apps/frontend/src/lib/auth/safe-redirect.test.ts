import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/lib/auth/safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeRedirectPath("/admin/users?tab=1")).toBe("/admin/users?tab=1");
  });

  it("falls back for anything that could leave the app", () => {
    for (const value of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "admin"]) {
      expect(safeRedirectPath(value)).toBe("/");
    }
  });
});
