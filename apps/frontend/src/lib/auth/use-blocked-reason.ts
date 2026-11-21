import { useTranslation } from "react-i18next";

import type { Permission } from "@subsurf/contracts/auth/permissions";

import { usePermissionLabel } from "@/lib/auth/labels";
import { usePermissions } from "@/lib/auth/use-can";

/** Why an action is unavailable: the first missing permission, else `disabledReason`. */
export function useBlockedReason(permissions: Permission[], disabledReason?: string) {
  const { t } = useTranslation("auth");
  const held = usePermissions();
  const permissionLabel = usePermissionLabel();
  const missing = permissions.find((permission) => !held.has(permission));
  return missing ? t("permissions.required", { permission: permissionLabel(missing) }) : disabledReason;
}
