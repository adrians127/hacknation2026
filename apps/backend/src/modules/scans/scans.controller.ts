import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import {
  ScanCompareQuerySchema,
  ScanHostListQuerySchema,
  type ScanDetail,
  type ScanHostDetail,
  type ScanHostListResponse,
  type ScanHostParams,
  type TagScanHostsBody,
  type TagScanHostsResponse,
} from "@subsurf/contracts/scans/scan-results.schema";
import {
  ScanChangesQuerySchema,
  type ScanChangesResponse,
} from "@subsurf/contracts/scans/scan-changes.schema";
import type { ScanListResponse } from "@subsurf/contracts/scans/scans.schema";

import { hostsService } from "~backend/modules/hosts/hosts.service";
import { changesCsv, changesFileName } from "~backend/modules/scans/scan-changes-csv";
import { scanResultsService } from "~backend/modules/scans/scan-results.service";

export const scansController = {
  list: async (_req: Request, res: Response<ScanListResponse>) => {
    res.status(200).json({ items: await scanResultsService.list() });
  },

  get: async (req: Request<IdParams>, res: Response<ScanDetail>) => {
    const { base } = ScanCompareQuerySchema.parse(req.query);
    res.status(200).json(await scanResultsService.get(req.params.id, base));
  },

  listHosts: async (req: Request<IdParams>, res: Response<ScanHostListResponse>) => {
    // validate() checked the query but cannot replace it: parse again for the numbers and defaults.
    const query = ScanHostListQuerySchema.parse(req.query);
    res.status(200).json(await scanResultsService.listHosts(req.params.id, query));
  },

  getHost: async (req: Request<ScanHostParams>, res: Response<ScanHostDetail>) => {
    const { base } = ScanCompareQuerySchema.parse(req.query);
    res.status(200).json(await scanResultsService.getHost(req.params.id, req.params.hostId, base));
  },

  changes: async (req: Request<IdParams>, res: Response<ScanChangesResponse | string>) => {
    const { base, format } = ScanChangesQuerySchema.parse(req.query);
    const changes = await scanResultsService.changes(req.params.id, base);
    if (format === "json") {
      res.status(200).json(changes);
      return;
    }
    res
      .status(200)
      .type("text/csv; charset=utf-8")
      .attachment(changesFileName(changes))
      .send(changesCsv(changes));
  },

  tagHosts: async (
    req: Request<IdParams, unknown, TagScanHostsBody>,
    res: Response<TagScanHostsResponse>,
  ) => {
    res.status(200).json(await hostsService.tagScanHosts(req.params.id, req.body));
  },
};
