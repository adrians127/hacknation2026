import type { Request, Response } from "express";

import type { DashboardResponse } from "@subsurf/contracts/dashboard/dashboard.schema";

import { dashboardService } from "~backend/modules/dashboard/dashboard.service";

export const dashboardController = {
  get: async (_req: Request, res: Response<DashboardResponse>) => {
    res.status(200).json(await dashboardService.get());
  },
};
