import type { z } from "zod";

import { registry } from "../../scripts/registry";
import {
  cookieAuth,
  forbidden,
  notFound,
  unauthenticated,
  validationFailed,
} from "../common/common.openapi";
import {
  DiffReportQuerySchema,
  DiffReportSchema,
  ExposureReportSchema,
  FindingsReportSchema,
  IpReportParamsSchema,
  IpReportSchema,
  ReportScanParamsSchema,
  ScanSummaryReportSchema,
  StabilityReportQuerySchema,
  StabilityReportSchema,
  TagsReportQuerySchema,
  TagsReportSchema,
  TechnologiesReportSchema,
  TimeOfDayReportQuerySchema,
  TimeOfDayReportSchema,
  TriageReportSchema,
} from "./reports.schema";

const tags = ["Reports"];
const security = cookieAuth;
const errors = { 400: validationFailed, 401: unauthenticated, 403: forbidden, 404: notFound };

function register(options: {
  path: string;
  operationId: string;
  summary: string;
  description: string;
  schema: z.ZodType;
  params?: z.ZodObject;
  query?: z.ZodObject;
}) {
  registry.registerPath({
    method: "get",
    path: options.path,
    operationId: options.operationId,
    summary: options.summary,
    description: `Requires \`scans:read\`. ${options.description}`,
    tags,
    security,
    request: { params: options.params, query: options.query },
    responses: {
      200: { description: "The report", content: { "application/json": { schema: options.schema } } },
      ...errors,
    },
  });
}

register({
  path: "/reports/scans/{id}/summary",
  operationId: "getScanSummaryReport",
  summary: "Post-scan summary report",
  description:
    "Execution, results, changes against the base scan, top findings, ports, technologies and triage of one scan.",
  schema: ScanSummaryReportSchema,
  params: ReportScanParamsSchema,
});

register({
  path: "/reports/scans/{id}/findings",
  operationId: "getFindingsReport",
  summary: "Interesting findings and host priority",
  description:
    "Passive rules over what the scan collected (exposed databases, admin panels, TLS, cookies, headers), with an analytical priority per host.",
  schema: FindingsReportSchema,
  params: ReportScanParamsSchema,
});

register({
  path: "/reports/scans/{id}/technologies",
  operationId: "getTechnologiesReport",
  summary: "Technologies, CMSs and groups of similar services",
  description:
    "Software identified from service detection, headers, meta generator tags, cookies and titles, with a confidence per detection.",
  schema: TechnologiesReportSchema,
  params: ReportScanParamsSchema,
});

register({
  path: "/reports/scans/{id}/exposure",
  operationId: "getExposureReport",
  summary: "Open ports by port and by /24 network",
  description: "How many hosts expose each port, and where in the network the live hosts are.",
  schema: ExposureReportSchema,
  params: ReportScanParamsSchema,
});

register({
  path: "/reports/scans/{id}/triage",
  operationId: "getTriageReport",
  summary: "Triage progress",
  description:
    "Verdicts on the scan's hosts and services, new services nobody reviewed yet, and DefectDojo remediation dates.",
  schema: TriageReportSchema,
  params: ReportScanParamsSchema,
});

register({
  path: "/reports/scans/{id}/tags",
  operationId: "getTagsReport",
  summary: "Hosts by tag",
  description: "Every tag of the scan's hosts and services; with `tag`, the hosts carrying it.",
  schema: TagsReportSchema,
  params: ReportScanParamsSchema,
  query: TagsReportQuerySchema,
});

register({
  path: "/reports/diff",
  operationId: "getDiffReport",
  summary: "Changes between any two scans",
  description:
    "Compares scan `to` with scan `from` by the same rules as a scan's changes against its base scan. 400 `SAME_SCAN` when both are one scan.",
  schema: DiffReportSchema,
  query: DiffReportQuerySchema,
});

register({
  path: "/reports/ips/{ip}",
  operationId: "getIpReport",
  summary: "One IP address across every scan",
  description:
    "Its status in every scan, how each service changed over time, and findings and technologies from the latest scan it answered.",
  schema: IpReportSchema,
  params: IpReportParamsSchema,
});

register({
  path: "/reports/stability",
  operationId: "getStabilityReport",
  summary: "Unstable and inactive hosts",
  description:
    "Hosts that come and go across the latest scans, ports that open and close, and hosts that should be reported as inactive.",
  schema: StabilityReportSchema,
  query: StabilityReportQuerySchema,
});

register({
  path: "/reports/time-of-day",
  operationId: "getTimeOfDayReport",
  summary: "Availability by time of day",
  description: "Hosts and ports that answer in some parts of the day only, across the latest scans.",
  schema: TimeOfDayReportSchema,
  query: TimeOfDayReportQuerySchema,
});
