import { z } from "zod";

import { EmailSchema } from "../auth/auth.schema";
import { NonBlankStringSchema } from "../common/common.schema";
import { RoleSummarySchema } from "../roles/roles.schema";

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: RoleSummarySchema,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  lockedUntil: z.iso.datetime().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const UserListResponseSchema = z.object({ items: z.array(UserSchema) });

const DisplayNameSchema = NonBlankStringSchema.max(100);

export const CreateUserBodySchema = z.object({
  email: EmailSchema,
  displayName: DisplayNameSchema,
  roleId: z.uuid(),
});

export const UpdateUserBodySchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    roleId: z.uuid().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one field to update",
  });

/** Returned once, on create and on reset. The server never shows this password again. */
export const UserWithTemporaryPasswordResponseSchema = z.object({
  user: UserSchema,
  temporaryPassword: z.string(),
});

export type User = z.infer<typeof UserSchema>;
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;
export type UpdateUserBody = z.infer<typeof UpdateUserBodySchema>;
export type UserWithTemporaryPasswordResponse = z.infer<
  typeof UserWithTemporaryPasswordResponseSchema
>;
