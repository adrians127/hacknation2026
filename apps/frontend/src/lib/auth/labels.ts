import { useTranslation } from "react-i18next";

import {
  PERMISSION_ACTIONS,
  PERMISSION_RESOURCES,
  type Permission,
  type PermissionAction,
  type PermissionResource,
  type SystemRoleKey,
} from "@hacknation/contracts/auth/permissions";

export function splitPermission(permission: Permission): {
  resource: PermissionResource;
  action: PermissionAction;
} {
  for (const resource of PERMISSION_RESOURCES) {
    for (const action of PERMISSION_ACTIONS) {
      if (`${resource}:${action}` === permission) return { resource, action };
    }
  }
  throw new Error(`Unknown permission ${permission}`);
}

interface RoleLike {
  key: SystemRoleKey | null;
  name: string;
  description?: string;
}

/** System roles are translated by key; custom roles show what the admin typed. */
export function useRoleLabels() {
  const { t } = useTranslation("auth");
  return {
    name: (role: RoleLike) => (role.key ? t(`roles.${role.key}.name`) : role.name),
    description: (role: RoleLike) =>
      role.key ? t(`roles.${role.key}.description`) : (role.description ?? ""),
  };
}

export function usePermissionLabel() {
  const { t } = useTranslation("auth");
  return (permission: Permission) => {
    const { resource, action } = splitPermission(permission);
    return `${t(`permissions.resources.${resource}`)}: ${t(`permissions.actions.${action}`)}`;
  };
}
