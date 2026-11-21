import { Router } from "express";

import { IdParamsSchema } from "@subsurf/contracts/common/common.schema";
import {
  HostListQuerySchema,
  HostServiceParamsSchema,
  UpdateHostBodySchema,
  UpdateServiceBodySchema,
} from "@subsurf/contracts/hosts/hosts.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { hostsController as c } from "~backend/modules/hosts/hosts.controller";

export const hostsRoutes = Router();

hostsRoutes.use(requireAuth);

hostsRoutes.get(
  "/",
  requirePermission("hosts:read"),
  validate({ query: HostListQuerySchema }),
  c.list,
);
hostsRoutes.get(
  "/:id",
  requirePermission("hosts:read"),
  validate({ params: IdParamsSchema }),
  c.get,
);
hostsRoutes.patch(
  "/:id",
  requirePermission("hosts:update"),
  validate({ params: IdParamsSchema, body: UpdateHostBodySchema }),
  c.update,
);
hostsRoutes.patch(
  "/:id/services/:serviceId",
  requirePermission("hosts:update"),
  validate({ params: HostServiceParamsSchema, body: UpdateServiceBodySchema }),
  c.updateService,
);
