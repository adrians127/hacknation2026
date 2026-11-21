import { Router } from "express";

import { healthController } from "~backend/modules/health/health.controller";

export const healthRoutes = Router();

healthRoutes.get("/", healthController.get);
