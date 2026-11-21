import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import {
  ScanHostListQuerySchema,
  ScanHostParamsSchema,
} from "@subsurf/contracts/scans/scan-results.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { scansController as c } from "~backend/modules/scans/scans.controller";

export const scansRoutes = Router();

scansRoutes.use(requireAuth, requirePermission("scans:read"));

scansRoutes.get("/", c.list);
scansRoutes.get("/:id", validate({ params: IdParamsSchema }), c.get);
scansRoutes.get(
  "/:id/hosts",
  validate({ params: IdParamsSchema, query: ScanHostListQuerySchema }),
  c.listHosts,
);
scansRoutes.get("/:id/hosts/:hostId", validate({ params: ScanHostParamsSchema }), c.getHost);
