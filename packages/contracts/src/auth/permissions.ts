import { z } from "zod";

/** Rows and columns of the admin panel's role matrix. A new module appends its resource (and any new action). */
export const PERMISSION_RESOURCES = [
  "users",
  "roles",
  "targets",
  "scans",
  "hosts",
  "vulnerabilities",
  "pipelines",
  "workers",
  "defectdojo",
] as const;
// `run` starts, stops and schedules scans, and starts vulnerability database syncs;
// `import`/`export` exchange data with an external system.
export const PERMISSION_ACTIONS = [
  "read",
  "create",
  "update",
  "delete",
  "run",
  "import",
  "export",
] as const;

export type PermissionResource = (typeof PERMISSION_RESOURCES)[number];
export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

/**
 * Every permission the backend checks, as `resource:action`. Not every
 * resource × action pair has to exist; the matrix disables the missing cells.
 * How system roles map onto new permissions: apps/backend/README.md ("RBAC").
 */
export const PERMISSIONS = [
  "users:read",
  "users:create",
  "users:update",
  "users:delete",
  "roles:read",
  "roles:create",
  "roles:update",
  "roles:delete",
  "targets:read",
  "targets:create",
  "targets:update",
  "targets:delete",
  "scans:read",
  "scans:run",
  "hosts:update",
  "vulnerabilities:read",
  "vulnerabilities:update",
  "vulnerabilities:create",
  "vulnerabilities:delete",
  "vulnerabilities:run",
  "pipelines:read",
  "pipelines:create",
  "pipelines:update",
  "pipelines:delete",
  "workers:read",
  "workers:update",
  "workers:delete",
  "defectdojo:read",
  "defectdojo:import",
  "defectdojo:export",
] as const satisfies readonly `${PermissionResource}:${PermissionAction}`[];

export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** The four roles from the task (section 2, item 13). Locked: seeded from code, not editable. */
export const SYSTEM_ROLE_KEYS = ["admin", "editor", "analyst", "viewer"] as const;

export const SystemRoleKeySchema = z.enum(SYSTEM_ROLE_KEYS);
export type SystemRoleKey = z.infer<typeof SystemRoleKeySchema>;

const READ = [
  "targets:read",
  "scans:read",
  "vulnerabilities:read",
  "pipelines:read",
  "workers:read",
  "defectdojo:read",
] as const satisfies readonly Permission[];

// Mapping rules: apps/backend/README.md ("Adding a permission"). Users and roles stay admin-only,
// and so do workers:update/delete (global scanner limits).
export const SYSTEM_ROLE_PERMISSIONS: Record<SystemRoleKey, readonly Permission[]> = {
  admin: PERMISSIONS,
  editor: [
    ...READ,
    "targets:create",
    "targets:update",
    "targets:delete",
    "scans:run",
    "hosts:update",
    "vulnerabilities:update",
    "vulnerabilities:create",
    "vulnerabilities:delete",
    "vulnerabilities:run",
    "pipelines:create",
    "pipelines:update",
    "pipelines:delete",
    "defectdojo:import",
    "defectdojo:export",
  ],
  analyst: [
    ...READ,
    "targets:update",
    "hosts:update",
    "vulnerabilities:update",
    "pipelines:update",
  ],
  viewer: READ,
};
