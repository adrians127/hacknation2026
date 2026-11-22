import { Router } from "express";

import {
  DiffReportQuerySchema,
  IpReportParamsSchema,
  ReportScanParamsSchema,
  StabilityReportQuerySchema,
  TagsReportQuerySchema,
  TimeOfDayReportQuerySchema,
} from "@subsurf/contracts/reports/reports.schema";

import { requireAuth } from "~backend/middleware/authenticate";
import { requirePermission } from "~backend/middleware/authorize";
import { validate } from "~backend/middleware/validate";
import { reportsController as c } from "~backend/modules/reports/reports.controller";

export const reportsRoutes = Router();

// Reports only read scan results, so they need what browsing them needs.
reportsRoutes.use(requireAuth, requirePermission("scans:read"));

const scan = validate({ params: ReportScanParamsSchema });

reportsRoutes.get("/scans/:id/summary", scan, c.summary);
reportsRoutes.get("/scans/:id/findings", scan, c.findings);
reportsRoutes.get("/scans/:id/technologies", scan, c.technologies);
reportsRoutes.get("/scans/:id/exposure", scan, c.exposure);
reportsRoutes.get("/scans/:id/triage", scan, c.triage);
reportsRoutes.get("/scans/:id/tags", validate({ params: ReportScanParamsSchema, query: TagsReportQuerySchema }), c.tags);
reportsRoutes.get("/diff", validate({ query: DiffReportQuerySchema }), c.diff);
reportsRoutes.get("/ips/:ip", validate({ params: IpReportParamsSchema }), c.ip);
reportsRoutes.get("/stability", validate({ query: StabilityReportQuerySchema }), c.stability);
reportsRoutes.get("/time-of-day", validate({ query: TimeOfDayReportQuerySchema }), c.timeOfDay);
