import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import {
  TargetListQuerySchema,
  type ImportTargetsBody,
  type ImportTargetsResponse,
  type Target,
  type TargetListResponse,
  type UpdateTargetBody,
} from "@subsurf/contracts/targets/targets.schema";

import { getAuth } from "~backend/lib/auth-context";
import { targetsService } from "~backend/modules/targets/targets.service";

export const targetsController = {
  list: async (req: Request, res: Response<TargetListResponse>) => {
    // validate() checked the query but cannot replace it: parse again for the numbers and defaults.
    res.status(200).json(await targetsService.list(TargetListQuerySchema.parse(req.query)));
  },

  update: async (req: Request<IdParams, unknown, UpdateTargetBody>, res: Response<Target>) => {
    res.status(200).json(await targetsService.update(req.params.id, req.body));
  },

  remove: async (req: Request<IdParams>, res: Response) => {
    await targetsService.remove(req.params.id);
    res.status(204).end();
  },

  importTargets: async (
    req: Request<object, unknown, ImportTargetsBody>,
    res: Response<ImportTargetsResponse>,
  ) => {
    res.status(201).json(await targetsService.importTargets(getAuth(req), req.body));
  },
};
