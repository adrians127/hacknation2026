import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import type {
  UpdateWorkerBody,
  Worker,
  WorkerListResponse,
} from "@subsurf/contracts/workers/worker-registry.schema";

import { workersService } from "~backend/modules/workers/workers.service";

export const workersController = {
  list: async (_req: Request, res: Response<WorkerListResponse>) => {
    res.status(200).json(await workersService.list());
  },

  update: async (req: Request<IdParams, unknown, UpdateWorkerBody>, res: Response<Worker>) => {
    res.status(200).json(await workersService.update(req.params.id, req.body));
  },

  delete: async (req: Request<IdParams>, res: Response) => {
    await workersService.remove(req.params.id);
    res.status(204).end();
  },
};
