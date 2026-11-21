import type { Request, Response } from "express";

import type { HealthResponse } from "@subsurf/contracts/health/health.schema";

import { healthService } from "~backend/modules/health/health.service";

export const healthController = {
  get: async (_req: Request, res: Response<HealthResponse>): Promise<void> => {
    res.status(200).json(await healthService.getStatus());
  },
};
