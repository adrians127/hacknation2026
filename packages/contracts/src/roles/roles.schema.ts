import { z } from "zod";

import { PERMISSIONS, PermissionSchema, SystemRoleKeySchema } from "../auth/permissions";
import { NonBlankStringSchema } from "../common/common.schema";

/** `key` is set only for the four system roles; the UI translates those by key. */
export const RoleSummarySchema = z.object({
  id: z.uuid(),
  key: SystemRoleKeySchema.nullable(),
  name: z.string(),
});

export const RoleSchema = RoleSummarySchema.extend({
  description: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(PermissionSchema),
  userCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const RoleListResponseSchema = z.object({ items: z.array(RoleSchema) });

export const RoleMemberSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  isActive: z.boolean(),
});

export const RoleDetailResponseSchema = RoleSchema.extend({
  users: z.array(RoleMemberSchema),
});

const RoleNameSchema = NonBlankStringSchema.max(64);
const RoleDescriptionSchema = z.string().max(500);
const RolePermissionsSchema = z.array(PermissionSchema).max(PERMISSIONS.length);

export const CreateRoleBodySchema = z.object({
  name: RoleNameSchema,
  description: RoleDescriptionSchema,
  permissions: RolePermissionsSchema,
});

export const UpdateRoleBodySchema = z
  .object({
    name: RoleNameSchema.optional(),
    description: RoleDescriptionSchema.optional(),
    permissions: RolePermissionsSchema.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

export const DeleteRoleQuerySchema = z.object({
  reassignToRoleId: z.uuid().optional(),
});

export type RoleSummary = z.infer<typeof RoleSummarySchema>;
export type Role = z.infer<typeof RoleSchema>;
export type RoleListResponse = z.infer<typeof RoleListResponseSchema>;
export type RoleMember = z.infer<typeof RoleMemberSchema>;
export type RoleDetailResponse = z.infer<typeof RoleDetailResponseSchema>;
export type CreateRoleBody = z.infer<typeof CreateRoleBodySchema>;
export type UpdateRoleBody = z.infer<typeof UpdateRoleBodySchema>;
export type DeleteRoleQuery = z.infer<typeof DeleteRoleQuerySchema>;
