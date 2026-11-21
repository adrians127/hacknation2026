import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import {
  CreateRoleBodySchema,
  DeleteRoleQuerySchema,
  UpdateRoleBodySchema,
} from "@subsurf/contracts/roles/roles.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { rolesController as c } from "~backend/modules/roles/roles.controller";

export const rolesRoutes = Router();

rolesRoutes.use(requireAuth);

rolesRoutes.get("/", requirePermission("roles:read"), c.list);
rolesRoutes.post(
  "/",
  requirePermission("roles:create"),
  validate({ body: CreateRoleBodySchema }),
  c.create,
);
rolesRoutes.get("/:id", requirePermission("roles:read"), validate({ params: IdParamsSchema }), c.get);
rolesRoutes.patch(
  "/:id",
  requirePermission("roles:update"),
  validate({ params: IdParamsSchema, body: UpdateRoleBodySchema }),
  c.update,
);
rolesRoutes.delete(
  "/:id",
  requirePermission("roles:delete"),
  validate({ params: IdParamsSchema, query: DeleteRoleQuerySchema }),
  c.delete,
);
