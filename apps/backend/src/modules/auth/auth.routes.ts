import { Router } from "express";

import { ChangePasswordBodySchema, LoginBodySchema } from "@subsurf/contracts/auth/auth.schema";

import { requireSession } from "~backend/middleware/authenticate";
import { validate } from "~backend/middleware/validate";
import { authController } from "~backend/modules/auth/auth.controller";

export const authRoutes = Router();

authRoutes.post("/login", validate({ body: LoginBodySchema }), authController.login);
authRoutes.post("/refresh", authController.refresh);
authRoutes.post("/logout", authController.logout);
authRoutes.get("/me", requireSession, authController.me);
authRoutes.post(
  "/change-password",
  requireSession,
  validate({ body: ChangePasswordBodySchema }),
  authController.changePassword,
);
