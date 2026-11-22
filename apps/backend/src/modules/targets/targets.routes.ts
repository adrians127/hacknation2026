import express, { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import { TARGET_IMPORT_LIMITS } from "@subsurf/contracts/targets/target-input";
import { ImportTargetsBodySchema, UpdateTargetBodySchema } from "@subsurf/contracts/targets/targets.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { targetsController as c } from "~backend/modules/targets/targets.controller";

export const targetsRoutes = Router();

targetsRoutes.use(requireAuth);

targetsRoutes.get("/", requirePermission("targets:read"), c.list);
// Its own body parser, after the permission check: app.ts skips this path in the global 1 MB one.
targetsRoutes.post(
  "/import",
  requirePermission("targets:create"),
  express.json({ limit: TARGET_IMPORT_LIMITS.maxFileBytes }),
  validate({ body: ImportTargetsBodySchema }),
  c.importTargets,
);
targetsRoutes.patch(
  "/:id",
  requirePermission("targets:update"),
  validate({ params: IdParamsSchema, body: UpdateTargetBodySchema }),
  c.update,
);
targetsRoutes.delete(
  "/:id",
  requirePermission("targets:delete"),
  validate({ params: IdParamsSchema }),
  c.delete,
);
