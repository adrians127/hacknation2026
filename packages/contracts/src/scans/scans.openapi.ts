import { z } from "zod";

import { registry } from "../../scripts/registry";
import {
  cookieAuth,
  errorResponse,
  forbidden,
  notFound,
  unauthenticated,
  validationFailed,
} from "../common/common.openapi";
import { IdParamsSchema } from "../common/common.schema";
import {
  ScanCompareQuerySchema,
  ScanDetailSchema,
  ScanHostDetailSchema,
  ScanHostListQuerySchema,
  ScanHostListResponseSchema,
  ScanHostParamsSchema,
  TagScanHostsBodySchema,
  TagScanHostsResponseSchema,
} from "./scan-results.schema";
import { ScanChangesQuerySchema, ScanChangesResponseSchema } from "./scan-changes.schema";
import { ScanExportDocumentSchema, ScanExportQuerySchema } from "./scan-export.schema";
import { ImportScanQuerySchema, ImportScanResponseSchema } from "./scan-import.schema";
import { ScanJobListQuerySchema, ScanJobListResponseSchema } from "./scan-jobs.schema";
import { ScanListResponseSchema } from "./scans.schema";

const tags = ["Scans"];
const security = cookieAuth;

registry.registerPath({
  method: "get",
  path: "/scans",
  operationId: "listScans",
  summary: "List scans",
  description: "Requires `scans:read`. Newest first, with host counts and open ports so far.",
  tags,
  security,
  responses: {
    200: {
      description: "All scans",
      content: { "application/json": { schema: ScanListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/scans/{id}",
  operationId: "getScan",
  summary: "Get a scan with its jobs and the changes since the base scan",
  description: [
    "Requires `scans:read`. Changes are counted against the base scan: `base` if given (it must",
    "be older), otherwise the previous scan with results. `coverage` counts the addresses each",
    "scan answered for; a host is only `new` or `gone` where both did.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema, query: ScanCompareQuerySchema },
  responses: {
    200: {
      description: "The scan",
      content: { "application/json": { schema: ScanDetailSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/scans/{id}/hosts",
  operationId: "listScanHosts",
  summary: "List the hosts of a scan, with their services and changes",
  description: [
    "Requires `scans:read`. Hosts that were up in this scan, plus hosts that were up in the base",
    "scan (`base`, or the previous scan with results) and are now `down` (gone) or did not answer",
    "(unknown), in address order. Each service carries the base scan's observation (`before`).",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema, query: ScanHostListQuerySchema },
  responses: {
    200: {
      description: "One page of hosts",
      content: { "application/json": { schema: ScanHostListResponseSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/scans/{id}/hosts/{hostId}",
  operationId: "getScanHost",
  summary: "Get a host as one scan saw it",
  description: [
    "Requires `scans:read`. Services with their decrypted details from this scan, compared with",
    "the base scan (`base`, or the previous scan with results), and the address's scan history.",
  ].join(" "),
  tags,
  security,
  request: { params: ScanHostParamsSchema, query: ScanCompareQuerySchema },
  responses: {
    200: {
      description: "The host in this scan",
      content: { "application/json": { schema: ScanHostDetailSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/scans/{id}/hosts/tags",
  operationId: "tagScanHosts",
  summary: "Add a tag to, or remove it from, the scan's hosts in the given addresses and CIDRs",
  description: [
    "Requires `scans:read` and `hosts:update`. Matches the hosts the scan lists (gone and unknown",
    "included). Tags belong to the Host assets, so the change shows in every scan and later scans",
    "keep it. Hosts that already have the maximum number of tags are skipped.",
  ].join(" "),
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: TagScanHostsBodySchema } } },
  },
  responses: {
    200: {
      description: "How many hosts matched and how many changed",
      content: { "application/json": { schema: TagScanHostsResponseSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/scans/{id}/changes",
  operationId: "exportScanChanges",
  summary: "Export the changes since the base scan, one row per change, as JSON or CSV",
  description: [
    "Requires `scans:read`. Compared with `base` (older) or the previous scan with results. Rows",
    "for new, gone and unknown hosts, opened and closed ports, and each changed field, with a",
    "priority and its reason. CSV cells that start with `=`, `+`, `-` or `@` get a leading `'`",
    "so spreadsheets do not run them as formulas.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema, query: ScanChangesQuerySchema },
  responses: {
    200: {
      description: "The changes",
      content: {
        "application/json": { schema: ScanChangesResponseSchema },
        "text/csv": { schema: z.string() },
      },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/scans/{id}/export",
  operationId: "exportScan",
  summary: "Export a scan's results, with the users' edits, as JSON or CSV",
  description: [
    "Requires `scans:read`. Every address the scan covered as this scan saw it, sensitive fields",
    "decrypted, plus the notes, tags, triage and service corrections of its hosts. JSON lists the",
    "addresses that are not `down` in the worker result's host shape and names the covered blocks",
    "in `coverage` (an address in them without an entry is `down`); `POST /scans/import` reads the",
    "file back. CSV has one row per HTTP endpoint and leaves out headers, cookies, certificates,",
    "banners and probes; cells that start with `=`, `+`, `-` or `@` get a leading `'`.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema, query: ScanExportQuerySchema },
  responses: {
    200: {
      description: "The scan as a file",
      content: {
        "application/json": { schema: ScanExportDocumentSchema },
        "text/csv": { schema: z.string() },
      },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/scans/import",
  operationId: "importScan",
  summary: "Import a results file as a new scan",
  description: [
    "Requires `scans:read` and `scans:create`; `edits=fill` also requires `hosts:update`. The body",
    "is the file itself: a scan export (`GET /scans/{id}/export`) as JSON or CSV, one worker result",
    "(`{ scan, hosts }`, docs/worker-result-format.md) or a list of them. CSV needs only an `ip`",
    "column; rows it cannot read are skipped and reported in `warnings`. The results are ingested",
    "the way a worker's own are. The scan takes its place among the others by when the file says",
    "it ran, so it can become the base scan of a newer one. The same content is imported once",
    "(`SCAN_ALREADY_IMPORTED` carries the existing scan's id in `details.scanId`).",
    "`SCAN_IMPORT_INVALID` lists what is wrong in `details.issues`.",
  ].join(" "),
  tags,
  security,
  request: {
    query: ImportScanQuerySchema,
    body: {
      required: true,
      content: {
        "application/json": { schema: z.unknown() },
        "text/csv": { schema: z.string() },
      },
    },
  },
  responses: {
    201: {
      description: "The scan the file became",
      content: { "application/json": { schema: ImportScanResponseSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    409: errorResponse("The file was imported before, or another import is running"),
  },
});

registry.registerPath({
  method: "get",
  path: "/scans/{id}/jobs",
  operationId: "listScanJobs",
  summary: "List a scan's jobs",
  description: [
    "Requires `scans:read`. In step order, then sequence; `step` and `status` filter. A step that",
    "takes the previous step's hosts gets a job each time one of the previous step's jobs completes.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema, query: ScanJobListQuerySchema },
  responses: {
    200: {
      description: "One page of jobs",
      content: { "application/json": { schema: ScanJobListResponseSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/scans/{id}/stop",
  operationId: "stopScan",
  summary: "Stop a scan",
  description: [
    "Requires `scans:read` and `scans:run`. Queued jobs are stopped; leased ones finish their",
    "current run (worker-manager has no cancel channel), and the scan ends once they do.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    204: { description: "Stopped, or stopping once the leased jobs end" },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("The scan has already ended (`SCAN_NOT_STOPPABLE`)"),
  },
});
