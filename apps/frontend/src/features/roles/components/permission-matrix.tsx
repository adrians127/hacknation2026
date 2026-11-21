import { Check, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  PERMISSION_ACTIONS,
  PERMISSIONS,
  type Permission,
} from "@subsurf/contracts/auth/permissions";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildPermissionMatrix,
  columnPermissions,
  groupState,
  rowPermissions,
  toggleGroup,
} from "@/features/roles/lib/permission-matrix";
import { usePermissionLabel } from "@/lib/auth/labels";

const ROWS = buildPermissionMatrix();

interface PermissionMatrixProps {
  value: readonly Permission[];
  /** Omit for a read-only matrix (system roles, role details). */
  onChange?: (next: Permission[]) => void;
  /** Permissions the editor may grant; the rest are disabled. Defaults to all. */
  grantable?: ReadonlySet<Permission>;
}

export function PermissionMatrix({ value, onChange, grantable }: PermissionMatrixProps) {
  const { t } = useTranslation("admin");
  const { t: tAuth } = useTranslation("auth");
  const permissionLabel = usePermissionLabel();
  const editable = grantable ?? new Set<Permission>(PERMISSIONS);
  const readOnly = !onChange;

  const toggleOne = (permission: Permission) =>
    onChange?.(toggleGroup(value, [permission], editable));

  const cellControl = (permission: Permission) => {
    const checked = value.includes(permission);
    if (readOnly) {
      return checked ? (
        <Check className="size-4 text-primary" aria-label={permissionLabel(permission)} />
      ) : (
        <Minus className="size-4 text-muted-foreground/50" aria-hidden />
      );
    }
    if (editable.has(permission)) {
      return (
        <Checkbox
          checked={checked}
          onCheckedChange={() => toggleOne(permission)}
          aria-label={permissionLabel(permission)}
        />
      );
    }
    // aria-disabled, not disabled: it stays focusable so the tooltip can say why.
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Checkbox
            checked={checked}
            aria-disabled
            className="cursor-not-allowed opacity-50"
            onClick={(event) => event.preventDefault()}
            aria-label={`${permissionLabel(permission)}: ${t("roles.matrix.notGrantable")}`}
          />
        </TooltipTrigger>
        <TooltipContent>{t("roles.matrix.notGrantable")}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("roles.matrix.resource")}</TableHead>
            {PERMISSION_ACTIONS.map((action) => {
              const column = columnPermissions(ROWS, action);
              const actionLabel = tAuth(`permissions.actions.${action}`);
              return (
                <TableHead key={action} className="text-center">
                  <div className="flex flex-col items-center gap-1.5 py-1">
                    <span>{actionLabel}</span>
                    {!readOnly && (
                      <Checkbox
                        checked={groupState(value, column)}
                        disabled={!column.some((permission) => editable.has(permission))}
                        onCheckedChange={() => onChange(toggleGroup(value, column, editable))}
                        aria-label={t("roles.matrix.toggleColumn", { action: actionLabel })}
                      />
                    )}
                  </div>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => {
            const permissions = rowPermissions(row);
            const resourceLabel = tAuth(`permissions.resources.${row.resource}`);
            return (
              <TableRow key={row.resource}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {!readOnly && (
                      <Checkbox
                        checked={groupState(value, permissions)}
                        disabled={!permissions.some((permission) => editable.has(permission))}
                        onCheckedChange={() => onChange(toggleGroup(value, permissions, editable))}
                        aria-label={t("roles.matrix.toggleRow", { resource: resourceLabel })}
                      />
                    )}
                    <span className="font-medium">{resourceLabel}</span>
                  </div>
                </TableCell>
                {row.cells.map((cell) => (
                  <TableCell key={cell.action}>
                    {/* Checkboxes are flex items, so text-center alone would not center them. */}
                    <div className="flex justify-center">
                      {cell.permission ? (
                        cellControl(cell.permission)
                      ) : (
                        <span className="text-muted-foreground" title={t("roles.matrix.notAvailable")}>
                          ·
                        </span>
                      )}
                    </div>
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
