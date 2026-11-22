import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import { ScanChangesQuerySchema } from "@subsurf/contracts/scans/scan-changes.schema";
import {
  ScanCompareQuerySchema,
  ScanHostListQuerySchema,
  ScanHostParamsSchema,
  TagScanHostsBodySchema,
} from "@subsurf/contracts/scans/scan-results.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { scansController as c } from "~backend/modules/scans/scans.controller";

export const scansRoutes = Router();

scansRoutes.use(requireAuth, requirePermission("scans:read"));

scansRoutes.get("/", c.list);
scansRoutes.get("/:id", validate({ params: IdParamsSchema, query: ScanCompareQuerySchema }), c.get);
scansRoutes.get(
  "/:id/changes",
  validate({ params: IdParamsSchema, query: ScanChangesQuerySchema }),
  c.changes,
);
scansRoutes.get(
  "/:id/hosts",
  validate({ params: IdParamsSchema, query: ScanHostListQuerySchema }),
  c.listHosts,
);
scansRoutes.get(
  "/:id/hosts/:hostId",
  validate({ params: ScanHostParamsSchema, query: ScanCompareQuerySchema }),
  c.getHost,
);
scansRoutes.post(
  "/:id/hosts/tags",
  requirePermission("hosts:update"),
  validate({ params: IdParamsSchema, body: TagScanHostsBodySchema }),
  c.tagHosts,
);
