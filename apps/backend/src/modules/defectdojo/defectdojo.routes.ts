import { Router } from "express";

import { DefectDojoPushBodySchema } from "@subsurf/contracts/defectdojo/defectdojo.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { defectDojoController as c } from "~backend/modules/defectdojo/defectdojo.controller";

export const defectDojoRoutes = Router();

defectDojoRoutes.use(requireAuth);

defectDojoRoutes.get("/sync", requirePermission("defectdojo:read"), c.status);
defectDojoRoutes.post("/sync", requirePermission("defectdojo:import"), c.sync);
defectDojoRoutes.post(
  "/push",
  requirePermission("defectdojo:export"),
  validate({ body: DefectDojoPushBodySchema }),
  c.push,
);
