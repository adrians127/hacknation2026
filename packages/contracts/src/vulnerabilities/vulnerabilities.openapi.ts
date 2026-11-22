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
  CreatePackageMappingBodySchema,
  JobRequestSchema,
  PackageMappingListResponseSchema,
  PackageMappingSchema,
  RequestSyncBodySchema,
  ServiceVulnerabilityParamsSchema,
  ServiceVulnerabilityTriageSchema,
  SourceParamsSchema,
  SyncRunListResponseSchema,
  UpdateServiceVulnerabilityBodySchema,
  UpdateSourceBodySchema,
  VulnerabilitySourceListResponseSchema,
  VulnerabilitySourceSchema,
} from "./vulnerabilities.schema";

const tags = ["Vulnerabilities"];
const security = cookieAuth;

const VulnerabilitySource = registry.register("VulnerabilitySource", VulnerabilitySourceSchema);
const JobRequest = registry.register("VulnerabilityJobRequest", JobRequestSchema);
const PackageMapping = registry.register("PackageMapping", PackageMappingSchema);

registry.registerPath({
  method: "get",
  path: "/vulnerabilities/sources",
  operationId: "listVulnerabilitySources",
  summary: "List the vulnerability databases and their sync state",
  description: [
    "Requires `vulnerabilities:read`. Each source (NVD, OSV) is mirrored into the database by the",
    "`vuln-sync` process: incrementally every few hours, fully once a week and on request.",
  ].join(" "),
  tags,
  security,
  responses: {
    200: {
      description: "Sources",
      content: { "application/json": { schema: VulnerabilitySourceListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/vulnerabilities/sources/{id}/runs",
  operationId: "listVulnerabilitySyncRuns",
  summary: "List a source's recent sync runs",
  description: "Requires `vulnerabilities:read`. Newest first, with what each run changed.",
  tags,
  security,
  request: { params: SourceParamsSchema },
  responses: {
    200: {
      description: "Sync runs",
      content: { "application/json": { schema: SyncRunListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/vulnerabilities/sources/{id}/sync",
  operationId: "requestVulnerabilitySync",
  summary: "Ask the sync process to sync a source now",
  description: [
    "Requires `vulnerabilities:run`. Queues the request; the `vuln-sync` process picks it up within",
    "its poll interval and re-matches every service afterwards. A request already waiting for the",
    "same source is returned instead of a new one.",
  ].join(" "),
  tags,
  security,
  request: {
    params: SourceParamsSchema,
    body: { content: { "application/json": { schema: RequestSyncBodySchema } } },
  },
  responses: {
    202: {
      description: "The queued request",
      content: { "application/json": { schema: JobRequest } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("The source is disabled (`SOURCE_DISABLED`)"),
  },
});

registry.registerPath({
  method: "patch",
  path: "/vulnerabilities/sources/{id}",
  operationId: "updateVulnerabilitySource",
  summary: "Enable or disable a source",
  description: [
    "Requires `vulnerabilities:run`. A disabled source is not synced and its matches are retracted",
    "(`source_disabled`) at the next re-match; its records stay in the database.",
  ].join(" "),
  tags,
  security,
  request: {
    params: SourceParamsSchema,
    body: { content: { "application/json": { schema: UpdateSourceBodySchema } } },
  },
  responses: {
    200: {
      description: "The source",
      content: { "application/json": { schema: VulnerabilitySource } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "get",
  path: "/vulnerabilities/mappings",
  operationId: "listPackageMappings",
  summary: "List the CPE → package mappings",
  description: [
    "Requires `vulnerabilities:read`. Package databases (OSV) describe packages, not CPE products:",
    "a mapping says which package a product reported by the scanner is in a given ecosystem.",
  ].join(" "),
  tags,
  security,
  responses: {
    200: {
      description: "Mappings, sorted by vendor and product",
      content: { "application/json": { schema: PackageMappingListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/vulnerabilities/mappings",
  operationId: "createPackageMapping",
  summary: "Add a CPE → package mapping",
  description: "Requires `vulnerabilities:create`. Queues a re-match of every service.",
  tags,
  security,
  request: {
    body: { content: { "application/json": { schema: CreatePackageMappingBodySchema } } },
  },
  responses: {
    201: {
      description: "The mapping",
      content: { "application/json": { schema: PackageMapping } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    409: errorResponse("The mapping already exists (`PACKAGE_MAPPING_EXISTS`)"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/vulnerabilities/mappings/{id}",
  operationId: "deletePackageMapping",
  summary: "Remove a CPE → package mapping",
  description: "Requires `vulnerabilities:delete`. Queues a re-match of every service.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    204: { description: "Removed" },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/vulnerabilities/services/{serviceId}/{canonicalId}",
  operationId: "updateServiceVulnerability",
  summary: "Triage a vulnerability of a service",
  description: [
    "Requires `vulnerabilities:update`. The verdict belongs to users: it is kept per service and",
    "vulnerability, so it survives syncs, retractions and later scans. The note is encrypted at",
    "rest.",
  ].join(" "),
  tags,
  security,
  request: {
    params: ServiceVulnerabilityParamsSchema,
    body: { content: { "application/json": { schema: UpdateServiceVulnerabilityBodySchema } } },
  },
  responses: {
    200: {
      description: "The triage",
      content: { "application/json": { schema: ServiceVulnerabilityTriageSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: errorResponse("No such service, or it never matched this vulnerability"),
  },
});
