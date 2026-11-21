import { z } from "zod";

import { RoleSummarySchema } from "../roles/roles.schema";
import { PermissionSchema } from "./permissions";

// NIST 800-63B: length over composition rules. The upper bound caps argon2 work per request.
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const NewPasswordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const EmailSchema = z.email().max(254);

export const LoginBodySchema = z.object({
  email: EmailSchema,
  // No minimum here: the login form must not reveal the password policy.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const ChangePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: NewPasswordSchema,
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ["newPassword"],
    message: "New password must differ from the current one",
  });

export const MeResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string(),
  role: RoleSummarySchema,
  permissions: z.array(PermissionSchema),
  mustChangePassword: z.boolean(),
});

export type LoginBody = z.infer<typeof LoginBodySchema>;
export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;
