import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import { UpdateWorkerBodySchema } from "@subsurf/contracts/workers/worker-registry.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { workersController as c } from "~backend/modules/workers/workers.controller";

/** The worker registry users manage (`/workers`); worker-manager's endpoints are manager.routes.ts. */
export const workersRoutes = Router();

workersRoutes.use(requireAuth);

workersRoutes.get("/", requirePermission("workers:read"), c.list);
workersRoutes.patch(
  "/:id",
  requirePermission("workers:update"),
  validate({ params: IdParamsSchema, body: UpdateWorkerBodySchema }),
  c.update,
);
workersRoutes.delete(
  "/:id",
  requirePermission("workers:delete"),
  validate({ params: IdParamsSchema }),
  c.delete,
);
