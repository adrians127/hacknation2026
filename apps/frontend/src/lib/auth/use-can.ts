import type { Permission } from "@subsurf/contracts/auth/permissions";

import { useMe } from "@/lib/auth/me-query";

/** UI hint only: the backend checks every permission again. */
export function useCan(permission: Permission): boolean {
  return useMe().permissions.includes(permission);
}

export function usePermissions(): ReadonlySet<Permission> {
  return new Set(useMe().permissions);
}
