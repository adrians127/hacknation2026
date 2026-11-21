import {
  isPermission,
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  PERMISSIONS,
  type Permission,
  type PermissionAction,
  type PermissionResource,
} from "@hacknation/contracts/auth/permissions";

export interface MatrixRow {
  resource: PermissionResource;
  /** One cell per action column; `null` where the catalog has no such permission. */
  cells: { action: PermissionAction; permission: Permission | null }[];
}

/** Rows = resources, columns = actions, both straight from the catalog in contracts. */
export function buildPermissionMatrix(): MatrixRow[] {
  return PERMISSION_RESOURCES.map((resource) => ({
    resource,
    cells: PERMISSION_ACTIONS.map((action) => {
      const key = `${resource}:${action}`;
      return { action, permission: isPermission(key) ? key : null };
    }),
  }));
}

export function columnPermissions(rows: MatrixRow[], action: PermissionAction): Permission[] {
  return rows.flatMap((row) =>
    row.cells.flatMap((cell) => (cell.action === action && cell.permission ? [cell.permission] : [])),
  );
}

export function rowPermissions(row: MatrixRow): Permission[] {
  return row.cells.flatMap((cell) => (cell.permission ? [cell.permission] : []));
}

/**
 * Row/column toggle: if every grantable permission of the group is selected,
 * unselect them; otherwise select them. Permissions you cannot grant stay as they are.
 */
export function toggleGroup(
  selected: readonly Permission[],
  group: readonly Permission[],
  grantable: ReadonlySet<Permission>,
): Permission[] {
  const editable = group.filter((permission) => grantable.has(permission));
  const next = new Set(selected);
  const allOn = editable.every((permission) => next.has(permission));
  for (const permission of editable) {
    if (allOn) next.delete(permission);
    else next.add(permission);
  }
  return PERMISSIONS.filter((permission) => next.has(permission));
}

export function groupState(
  selected: readonly Permission[],
  group: readonly Permission[],
): boolean | "indeterminate" {
  const count = group.filter((permission) => selected.includes(permission)).length;
  if (count === 0) return false;
  return count === group.length ? true : "indeterminate";
}
