import { Router } from "express";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { dashboardController as c } from "~backend/modules/dashboard/dashboard.controller";

export const dashboardRoutes = Router();

dashboardRoutes.get("/", requireAuth, requirePermission("scans:read"), c.get);
