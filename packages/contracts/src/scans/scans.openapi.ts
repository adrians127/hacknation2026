import { registry } from "../../scripts/registry";
import {
  cookieAuth,
  forbidden,
  notFound,
  unauthenticated,
  validationFailed,
} from "../common/common.openapi";
import { IdParamsSchema } from "../common/common.schema";
import {
  ScanDetailSchema,
  ScanHostDetailSchema,
  ScanHostListQuerySchema,
  ScanHostListResponseSchema,
  ScanHostParamsSchema,
} from "./scan-results.schema";
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
  summary: "Get a scan with its jobs and the changes since the previous scan",
  description: [
    "Requires `scans:read`. Changes are counted against the base scan (the previous scan with",
    "results), only for addresses this scan answered for.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    200: {
      description: "The scan",
      content: { "application/json": { schema: ScanDetailSchema } },
    },
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
    "scan and are now `down` (gone) or did not answer (unknown), in address order.",
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
  description:
    "Requires `scans:read`. Services with their decrypted details from this scan, and the address's scan history.",
  tags,
  security,
  request: { params: ScanHostParamsSchema },
  responses: {
    200: {
      description: "The host in this scan",
      content: { "application/json": { schema: ScanHostDetailSchema } },
    },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});
