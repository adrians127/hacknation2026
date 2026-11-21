import type { Request, Response } from "express";

import type {
  ImportTargetsBody,
  ImportTargetsResponse,
} from "@hacknation/contracts/targets/targets.schema";

import { getAuth } from "~backend/lib/auth-context";
import { targetsService } from "~backend/modules/targets/targets.service";

export const targetsController = {
  importTargets: async (
    req: Request<object, unknown, ImportTargetsBody>,
    res: Response<ImportTargetsResponse>,
  ) => {
    res.status(201).json(await targetsService.importTargets(getAuth(req), req.body));
  },
};
