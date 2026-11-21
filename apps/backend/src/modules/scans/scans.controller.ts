import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import {
  ScanHostListQuerySchema,
  type ScanDetail,
  type ScanHostDetail,
  type ScanHostListResponse,
  type ScanHostParams,
} from "@subsurf/contracts/scans/scan-results.schema";
import type { ScanListResponse } from "@subsurf/contracts/scans/scans.schema";

import { scanResultsService } from "~backend/modules/scans/scan-results.service";

export const scansController = {
  list: async (_req: Request, res: Response<ScanListResponse>) => {
    res.status(200).json({ items: await scanResultsService.list() });
  },

  get: async (req: Request<IdParams>, res: Response<ScanDetail>) => {
    res.status(200).json(await scanResultsService.get(req.params.id));
  },

  listHosts: async (req: Request<IdParams>, res: Response<ScanHostListResponse>) => {
    // validate() checked the query but cannot replace it: parse again for the numbers and defaults.
    const query = ScanHostListQuerySchema.parse(req.query);
    res.status(200).json(await scanResultsService.listHosts(req.params.id, query));
  },

  getHost: async (req: Request<ScanHostParams>, res: Response<ScanHostDetail>) => {
    res.status(200).json(await scanResultsService.getHost(req.params.id, req.params.hostId));
  },
};
