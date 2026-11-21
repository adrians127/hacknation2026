import { Router } from "express";

import { IdParamsSchema } from "@hacknation/contracts/common/common.schema";
import {
  CreateUserBodySchema,
  UpdateUserBodySchema,
} from "@hacknation/contracts/users/users.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { usersController as c } from "~backend/modules/users/users.controller";

export const usersRoutes = Router();
const byId = validate({ params: IdParamsSchema });

usersRoutes.use(requireAuth);

usersRoutes.get("/", requirePermission("users:read"), c.list);
usersRoutes.post(
  "/",
  requirePermission("users:create"),
  validate({ body: CreateUserBodySchema }),
  c.create,
);
usersRoutes.get("/:id", requirePermission("users:read"), byId, c.get);
usersRoutes.patch(
  "/:id",
  requirePermission("users:update"),
  validate({ params: IdParamsSchema, body: UpdateUserBodySchema }),
  c.update,
);
usersRoutes.post("/:id/reset-password", requirePermission("users:update"), byId, c.resetPassword);
usersRoutes.post("/:id/deactivate", requirePermission("users:delete"), byId, c.deactivate);
usersRoutes.post("/:id/reactivate", requirePermission("users:delete"), byId, c.reactivate);
