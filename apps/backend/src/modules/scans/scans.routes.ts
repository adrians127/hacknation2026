import express, { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import { ScanChangesQuerySchema } from "@subsurf/contracts/scans/scan-changes.schema";
import { ScanExportQuerySchema } from "@subsurf/contracts/scans/scan-export.schema";
import { SCAN_IMPORT_LIMITS } from "@subsurf/contracts/scans/scan-import";
import { ImportScanQuerySchema } from "@subsurf/contracts/scans/scan-import.schema";
import { ScanJobListQuerySchema } from "@subsurf/contracts/scans/scan-jobs.schema";
import {
  ScanCompareQuerySchema,
  ScanHostListQuerySchema,
  ScanHostParamsSchema,
  TagScanHostsBodySchema,
} from "@subsurf/contracts/scans/scan-results.schema";
import { UpdateScanBodySchema } from "@subsurf/contracts/scans/scans.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { scansController as c } from "~backend/modules/scans/scans.controller";

export const scansRoutes = Router();

scansRoutes.use(requireAuth, requirePermission("scans:read"));

scansRoutes.get("/", c.list);
// Its own body parser, after the permission check: app.ts skips this path in the global 1 MB one.
scansRoutes.post(
  "/import",
  requirePermission("scans:create"),
  express.json({ limit: SCAN_IMPORT_LIMITS.maxFileBytes }),
  express.text({ type: ["text/csv", "text/plain"], limit: SCAN_IMPORT_LIMITS.maxFileBytes }),
  validate({ query: ImportScanQuerySchema }),
  c.importScan,
);
scansRoutes.get("/:id", validate({ params: IdParamsSchema, query: ScanCompareQuerySchema }), c.get);
scansRoutes.patch(
  "/:id",
  requirePermission("scans:update"),
  validate({ params: IdParamsSchema, body: UpdateScanBodySchema }),
  c.update,
);
scansRoutes.delete(
  "/:id",
  requirePermission("scans:delete"),
  validate({ params: IdParamsSchema }),
  c.remove,
);
scansRoutes.get(
  "/:id/changes",
  validate({ params: IdParamsSchema, query: ScanChangesQuerySchema }),
  c.changes,
);
scansRoutes.get(
  "/:id/export",
  validate({ params: IdParamsSchema, query: ScanExportQuerySchema }),
  c.exportScan,
);
scansRoutes.get(
  "/:id/jobs",
  validate({ params: IdParamsSchema, query: ScanJobListQuerySchema }),
  c.listJobs,
);
scansRoutes.post(
  "/:id/stop",
  requirePermission("scans:run"),
  validate({ params: IdParamsSchema }),
  c.stop,
);
scansRoutes.get(
  "/:id/hosts",
  validate({ params: IdParamsSchema, query: ScanHostListQuerySchema }),
  c.listHosts,
);
scansRoutes.get(
  "/:id/visualization-hosts",
  validate({ params: IdParamsSchema }),
  c.visualizationHosts,
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
