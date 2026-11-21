import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import {
  HostListQuerySchema,
  type HostDetail,
  type HostListResponse,
  type HostServiceParams,
  type ServiceDetail,
  type UpdateHostBody,
  type UpdateServiceBody,
} from "@subsurf/contracts/hosts/hosts.schema";

import { hostsService } from "~backend/modules/hosts/hosts.service";

export const hostsController = {
  list: async (req: Request, res: Response<HostListResponse>) => {
    // validate() checked the query but cannot replace it: parse again for the numbers and defaults.
    res.status(200).json(await hostsService.list(HostListQuerySchema.parse(req.query)));
  },

  get: async (req: Request<IdParams>, res: Response<HostDetail>) => {
    res.status(200).json(await hostsService.get(req.params.id));
  },

  update: async (req: Request<IdParams, unknown, UpdateHostBody>, res: Response<HostDetail>) => {
    res.status(200).json(await hostsService.update(req.params.id, req.body));
  },

  updateService: async (
    req: Request<HostServiceParams, unknown, UpdateServiceBody>,
    res: Response<ServiceDetail>,
  ) => {
    res
      .status(200)
      .json(await hostsService.updateService(req.params.id, req.params.serviceId, req.body));
  },
};
