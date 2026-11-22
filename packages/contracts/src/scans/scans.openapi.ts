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
  ScanCompareQuerySchema,
  ScanDetailSchema,
  ScanHostDetailSchema,
  ScanHostListQuerySchema,
  ScanHostListResponseSchema,
  ScanHostParamsSchema,
  TagScanHostsBodySchema,
  TagScanHostsResponseSchema,
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
