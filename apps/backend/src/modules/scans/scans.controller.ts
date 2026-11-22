import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Request, Response } from "express";

import type { IdParams } from "@subsurf/contracts/common/common.schema";
import {
  ScanCompareQuerySchema,
  ScanHostListQuerySchema,
  type ScanDetail,
  type ScanHostDetail,
  type ScanHostListResponse,
  type ScanVisualizationHostsResponse,
  type ScanHostParams,
  type TagScanHostsBody,
  type TagScanHostsResponse,
} from "@subsurf/contracts/scans/scan-results.schema";
import {
  ScanChangesQuerySchema,
  type ScanChangesResponse,
} from "@subsurf/contracts/scans/scan-changes.schema";
import { ScanExportQuerySchema } from "@subsurf/contracts/scans/scan-export.schema";
import { readScanCsv, readScanJson } from "@subsurf/contracts/scans/scan-import";
import {
  ImportScanQuerySchema,
  type ImportScanResponse,
} from "@subsurf/contracts/scans/scan-import.schema";
import {
  ScanJobListQuerySchema,
  type ScanJobListResponse,
} from "@subsurf/contracts/scans/scan-jobs.schema";
import type {
  UpdatedScan,
  ScanListResponse,
  UpdateScanBody,
} from "@subsurf/contracts/scans/scans.schema";

import { getAuth } from "~backend/lib/auth-context";
import { HttpError } from "~backend/lib/http-error";
import { hostsService } from "~backend/modules/hosts/hosts.service";
import { pipelineRuns } from "~backend/modules/pipelines/pipeline-runs.service";
import { changesCsv, changesFileName } from "~backend/modules/scans/scan-changes-csv";
import { scanEditsService } from "~backend/modules/scans/scan-edits.service";
import {
  scanExportCsv,
  scanExportFileName,
  scanExportJson,
} from "~backend/modules/scans/scan-export";
import { scanImportService } from "~backend/modules/scans/scan-import.service";
import { scanResultsService } from "~backend/modules/scans/scan-results.service";

export const scansController = {
  list: async (_req: Request, res: Response<ScanListResponse>) => {
    res.status(200).json({ items: await scanResultsService.list() });
  },

  get: async (req: Request<IdParams>, res: Response<ScanDetail>) => {
    const { base } = ScanCompareQuerySchema.parse(req.query);
    res.status(200).json(await scanResultsService.get(req.params.id, base));
  },

  listJobs: async (req: Request<IdParams>, res: Response<ScanJobListResponse>) => {
    const query = ScanJobListQuerySchema.parse(req.query);
    res.status(200).json(await scanResultsService.listJobs(req.params.id, query));
  },

  stop: async (req: Request<IdParams>, res: Response) => {
    await pipelineRuns.stop(req.params.id);
    res.status(204).end();
  },

  update: async (req: Request<IdParams, unknown, UpdateScanBody>, res: Response<UpdatedScan>) => {
    res.status(200).json(await scanEditsService.update(req.params.id, req.body));
  },

  remove: async (req: Request<IdParams>, res: Response) => {
    await scanEditsService.remove(req.params.id, getAuth(req).user.id);
    res.status(204).end();
  },

  listHosts: async (req: Request<IdParams>, res: Response<ScanHostListResponse>) => {
    // validate() checked the query but cannot replace it: parse again for the numbers and defaults.
    const query = ScanHostListQuerySchema.parse(req.query);
    res.status(200).json(await scanResultsService.listHosts(req.params.id, query));
  },

  visualizationHosts: async (req: Request<IdParams>, res: Response<ScanVisualizationHostsResponse>) => {
    res.status(200).json(await scanResultsService.visualizationHosts(req.params.id));
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

  exportScan: async (req: Request<IdParams>, res: Response) => {
    const { format } = ScanExportQuerySchema.parse(req.query);
    const source = await scanResultsService.forExport(req.params.id);
    const chunks = format === "json" ? scanExportJson(source, new Date()) : scanExportCsv(source);
    res
      .status(200)
      .type(format === "json" ? "application/json" : "text/csv; charset=utf-8")
      .attachment(scanExportFileName(source, format));
    try {
      await pipeline(Readable.from(chunks), res);
    } catch (error) {
      // The status line is sent: a cut connection is the only way left to fail the download.
      req.log.error({ err: error }, "Scan export failed midway");
      res.destroy();
    }
  },

  importScan: async (req: Request, res: Response<ImportScanResponse>) => {
    const query = ImportScanQuerySchema.parse(req.query);
    // `express.text` leaves a CSV body as a string; JSON arrives parsed.
    const body: unknown = req.body;
    const read = typeof body === "string" ? readScanCsv(body) : readScanJson(body);
    if (!read.ok) {
      throw new HttpError(400, "The file is not a scan this version can import", {
        code: "SCAN_IMPORT_INVALID",
        details: { issues: read.errors },
      });
    }
    const imported = await scanImportService.importScan(getAuth(req), read.import, query, read.warnings);
    req.log.info(
      { scanId: imported.scanId, format: imported.inputFormat, jobs: imported.jobs, hosts: imported.hosts },
      "scan imported",
    );
    res.status(201).json(imported);
  },

  tagHosts: async (
    req: Request<IdParams, unknown, TagScanHostsBody>,
    res: Response<TagScanHostsResponse>,
  ) => {
    res.status(200).json(await hostsService.tagScanHosts(req.params.id, req.body));
  },
};
