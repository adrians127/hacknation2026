import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import type {
  HostEdits,
  HostServiceParams,
  ServiceEdits,
  UpdateHostBody,
  UpdateServiceBody,
} from "@subsurf/contracts/hosts/hosts.schema";

import { hostsService } from "~backend/modules/hosts/hosts.service";

export const hostsController = {
  update: async (req: Request<IdParams, unknown, UpdateHostBody>, res: Response<HostEdits>) => {
    res.status(200).json(await hostsService.update(req.params.id, req.body));
  },

  updateService: async (
    req: Request<HostServiceParams, unknown, UpdateServiceBody>,
    res: Response<ServiceEdits>,
  ) => {
    res
      .status(200)
      .json(await hostsService.updateService(req.params.id, req.params.serviceId, req.body));
  },
};
