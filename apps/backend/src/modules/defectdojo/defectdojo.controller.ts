import type { Request, Response } from "express";

import type {
  DefectDojoPush,
  DefectDojoPushBody,
  DefectDojoStatus,
  DefectDojoSync,
} from "@subsurf/contracts/defectdojo/defectdojo.schema";

import { getAuth } from "~backend/lib/auth-context";
import { defectDojoPushService } from "~backend/modules/defectdojo/defectdojo.push";
import { defectDojoService } from "~backend/modules/defectdojo/defectdojo.service";

export const defectDojoController = {
  status: async (_req: Request, res: Response<DefectDojoStatus>) => {
    res.status(200).json(await defectDojoService.status());
  },

  sync: async (req: Request, res: Response<DefectDojoSync>) => {
    res.status(200).json(await defectDojoService.sync(getAuth(req).user.id));
  },

  push: async (req: Request<unknown, unknown, DefectDojoPushBody>, res: Response<DefectDojoPush>) => {
    res.status(200).json(await defectDojoPushService.push(getAuth(req).user.id, req.body));
  },
};
