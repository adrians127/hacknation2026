import { describe, expect, it } from "vitest";

import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  PERMISSIONS,
  type Permission,
} from "@hacknation/contracts/auth/permissions";

import {
  buildPermissionMatrix,
  columnPermissions,
  groupState,
  rowPermissions,
  toggleGroup,
} from "@/features/roles/lib/permission-matrix";

describe("permission matrix", () => {
  const rows = buildPermissionMatrix();

  it("has one row per resource and one cell per action, covering the whole catalog", () => {
    expect(rows.map((row) => row.resource)).toEqual([...PERMISSION_RESOURCES]);
    for (const row of rows) {
      expect(row.cells.map((cell) => cell.action)).toEqual([...PERMISSION_ACTIONS]);
    }
    const cells = rows.flatMap(rowPermissions);
    expect(cells.toSorted()).toEqual([...PERMISSIONS].toSorted());
  });

  it("selects a whole row, then clears it", () => {
    const users = rowPermissions(rows[0]);
    const all = new Set<Permission>(PERMISSIONS);

    const selected = toggleGroup(["roles:read"], users, all);
    expect(selected).toEqual([...users, "roles:read"]);
    expect(toggleGroup(selected, users, all)).toEqual(["roles:read"]);
  });

  it("never touches permissions the editor cannot grant", () => {
    const readColumn = columnPermissions(rows, "read");
    const grantable = new Set<Permission>(["users:read"]);

    expect(toggleGroup([], readColumn, grantable)).toEqual(["users:read"]);
    expect(toggleGroup(["users:read", "roles:read"], readColumn, grantable)).toEqual(["roles:read"]);
  });

  it("reports partial groups as indeterminate", () => {
    const readColumn = columnPermissions(rows, "read");

    expect(groupState([], readColumn)).toBe(false);
    expect(groupState(["users:read"], readColumn)).toBe("indeterminate");
    expect(groupState(readColumn, readColumn)).toBe(true);
  });
});
