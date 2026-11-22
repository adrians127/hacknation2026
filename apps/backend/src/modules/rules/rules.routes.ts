import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import {
  CreateRuleBodySchema,
  RulePreviewBodySchema,
  UpdateRuleBodySchema,
} from "@subsurf/contracts/rules/rules.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { rulesController as c } from "~backend/modules/rules/rules.controller";

export const rulesRoutes = Router();

rulesRoutes.use(requireAuth);

rulesRoutes.get("/", requirePermission("rules:read"), c.list);
rulesRoutes.post(
  "/",
  requirePermission("rules:create"),
  validate({ body: CreateRuleBodySchema }),
  c.create,
);
rulesRoutes.post(
  "/preview",
  requirePermission("rules:read"),
  validate({ body: RulePreviewBodySchema }),
  c.preview,
);
rulesRoutes.patch(
  "/:id",
  requirePermission("rules:update"),
  validate({ params: IdParamsSchema, body: UpdateRuleBodySchema }),
  c.update,
);
rulesRoutes.delete(
  "/:id",
  requirePermission("rules:delete"),
  validate({ params: IdParamsSchema }),
  c.remove,
);
