import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import {
  CreatePackageMappingBodySchema,
  RequestSyncBodySchema,
  ServiceVulnerabilityParamsSchema,
  SourceParamsSchema,
  UpdateServiceVulnerabilityBodySchema,
  UpdateSourceBodySchema,
} from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import {
  vulnerabilitiesController as c,
} from "~backend/modules/vulnerabilities/vulnerabilities.controller";

// Matches themselves are read through the scans (`/scans/{id}/hosts/{hostId}`, `scans:read`).
export const vulnerabilitiesRoutes = Router();

vulnerabilitiesRoutes.use(requireAuth);

vulnerabilitiesRoutes.get("/sources", requirePermission("vulnerabilities:read"), c.listSources);
vulnerabilitiesRoutes.get(
  "/sources/:id/runs",
  requirePermission("vulnerabilities:read"),
  validate({ params: SourceParamsSchema }),
  c.listRuns,
);
vulnerabilitiesRoutes.post(
  "/sources/:id/sync",
  requirePermission("vulnerabilities:run"),
  validate({ params: SourceParamsSchema, body: RequestSyncBodySchema }),
  c.requestSync,
);
vulnerabilitiesRoutes.patch(
  "/sources/:id",
  requirePermission("vulnerabilities:run"),
  validate({ params: SourceParamsSchema, body: UpdateSourceBodySchema }),
  c.updateSource,
);
vulnerabilitiesRoutes.get("/mappings", requirePermission("vulnerabilities:read"), c.listMappings);
vulnerabilitiesRoutes.post(
  "/mappings",
  requirePermission("vulnerabilities:create"),
  validate({ body: CreatePackageMappingBodySchema }),
  c.createMapping,
);
vulnerabilitiesRoutes.delete(
  "/mappings/:id",
  requirePermission("vulnerabilities:delete"),
  validate({ params: IdParamsSchema }),
  c.deleteMapping,
);
vulnerabilitiesRoutes.patch(
  "/services/:serviceId/:canonicalId",
  requirePermission("vulnerabilities:update"),
  validate({
    params: ServiceVulnerabilityParamsSchema,
    body: UpdateServiceVulnerabilityBodySchema,
  }),
  c.updateTriage,
);
