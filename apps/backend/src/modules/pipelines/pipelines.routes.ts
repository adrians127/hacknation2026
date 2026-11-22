import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import {
  PipelineBodySchema,
  SchedulePreviewBodySchema,
  UpdatePipelineBodySchema,
} from "@subsurf/contracts/pipelines/pipelines.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { pipelinesController as c } from "~backend/modules/pipelines/pipelines.controller";

export const pipelinesRoutes = Router();

pipelinesRoutes.use(requireAuth);

pipelinesRoutes.get("/", requirePermission("pipelines:read"), c.list);
pipelinesRoutes.post(
  "/",
  requirePermission("pipelines:create"),
  validate({ body: PipelineBodySchema }),
  c.create,
);
pipelinesRoutes.post(
  "/schedule/preview",
  requirePermission("pipelines:read"),
  validate({ body: SchedulePreviewBodySchema }),
  c.previewSchedule,
);
pipelinesRoutes.get(
  "/:id",
  requirePermission("pipelines:read"),
  validate({ params: IdParamsSchema }),
  c.get,
);
// Changing `schedule` or `enabled` also needs scans:run, checked in the service.
pipelinesRoutes.patch(
  "/:id",
  requirePermission("pipelines:update"),
  validate({ params: IdParamsSchema, body: UpdatePipelineBodySchema }),
  c.update,
);
pipelinesRoutes.delete(
  "/:id",
  requirePermission("pipelines:delete"),
  validate({ params: IdParamsSchema }),
  c.delete,
);
pipelinesRoutes.post(
  "/:id/runs",
  requirePermission("scans:run"),
  validate({ params: IdParamsSchema }),
  c.run,
);
