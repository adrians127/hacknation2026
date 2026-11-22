import type { Request, Response } from "express";

import {
  DiffReportQuerySchema,
  StabilityReportQuerySchema,
  TagsReportQuerySchema,
  TimeOfDayReportQuerySchema,
  type DiffReport,
  type ExposureReport,
  type FindingsReport,
  type IpReport,
  type IpReportParams,
  type ReportScanParams,
  type ScanSummaryReport,
  type StabilityReport,
  type TagsReport,
  type TechnologiesReport,
  type TimeOfDayReport,
  type TriageReport,
} from "@subsurf/contracts/reports/reports.schema";

import { diffReportService } from "~backend/modules/reports/diff-report";
import { historyReportsService } from "~backend/modules/reports/history-reports";
import { ipReportService } from "~backend/modules/reports/ip-report";
import { scanReportsService } from "~backend/modules/reports/scan-reports";

// validate() checked each query but cannot replace it: parse again for numbers and defaults.
export const reportsController = {
  summary: async (req: Request<ReportScanParams>, res: Response<ScanSummaryReport>) => {
    res.status(200).json(await scanReportsService.summary(req.params.id));
  },
  findings: async (req: Request<ReportScanParams>, res: Response<FindingsReport>) => {
    res.status(200).json(await scanReportsService.findings(req.params.id));
  },
  technologies: async (req: Request<ReportScanParams>, res: Response<TechnologiesReport>) => {
    res.status(200).json(await scanReportsService.technologies(req.params.id));
  },
  exposure: async (req: Request<ReportScanParams>, res: Response<ExposureReport>) => {
    res.status(200).json(await scanReportsService.exposure(req.params.id));
  },
  triage: async (req: Request<ReportScanParams>, res: Response<TriageReport>) => {
    res.status(200).json(await scanReportsService.triage(req.params.id));
  },
  tags: async (req: Request<ReportScanParams>, res: Response<TagsReport>) => {
    const { tag } = TagsReportQuerySchema.parse(req.query);
    res.status(200).json(await scanReportsService.tags(req.params.id, tag));
  },
  diff: async (req: Request, res: Response<DiffReport>) => {
    const { from, to } = DiffReportQuerySchema.parse(req.query);
    res.status(200).json(await diffReportService.diff(from, to));
  },
  ip: async (req: Request<IpReportParams>, res: Response<IpReport>) => {
    res.status(200).json(await ipReportService.report(req.params.ip));
  },
  stability: async (req: Request, res: Response<StabilityReport>) => {
    res.status(200).json(await historyReportsService.stability(StabilityReportQuerySchema.parse(req.query)));
  },
  timeOfDay: async (req: Request, res: Response<TimeOfDayReport>) => {
    res.status(200).json(await historyReportsService.timeOfDay(TimeOfDayReportQuerySchema.parse(req.query)));
  },
};
