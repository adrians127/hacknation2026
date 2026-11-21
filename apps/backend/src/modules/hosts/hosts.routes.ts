import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import {
  HostServiceParamsSchema,
  UpdateHostBodySchema,
  UpdateServiceBodySchema,
} from "@subsurf/contracts/hosts/hosts.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { hostsController as c } from "~backend/modules/hosts/hosts.controller";

// Hosts are read through the scans that saw them (`/scans/{id}/hosts`); this module edits them.
export const hostsRoutes = Router();

hostsRoutes.use(requireAuth, requirePermission("hosts:update"));

hostsRoutes.patch("/:id", validate({ params: IdParamsSchema, body: UpdateHostBodySchema }), c.update);
hostsRoutes.patch(
  "/:id/services/:serviceId",
  validate({ params: HostServiceParamsSchema, body: UpdateServiceBodySchema }),
  c.updateService,
);
