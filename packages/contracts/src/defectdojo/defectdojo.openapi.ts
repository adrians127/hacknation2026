import { registry } from "../../scripts/registry";
import {
  cookieAuth,
  errorResponse,
  forbidden,
  notFound,
  unauthenticated,
} from "../common/common.openapi";
import {
  DefectDojoPushBodySchema,
  DefectDojoPushSchema,
  DefectDojoStatusSchema,
  DefectDojoSyncSchema,
} from "./defectdojo.schema";

const tags = ["DefectDojo"];
const security = cookieAuth;

registry.registerPath({
  method: "get",
  path: "/defectdojo/sync",
  operationId: "getDefectDojoStatus",
  summary: "DefectDojo connection and the last sync",
  description: "Requires `defectdojo:read`.",
  tags,
  security,
  responses: {
    200: {
      description: "Whether DefectDojo is configured, and the last sync",
      content: { "application/json": { schema: DefectDojoStatusSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/defectdojo/sync",
  operationId: "syncDefectDojo",
  summary: "Pull the current DefectDojo data into hosts and services",
  description: [
    "Requires `defectdojo:import`. Reads every product and finding, matches findings to services",
    "by host:port and imports: finding tags (service tags), product tags and owners (host tags,",
    "`owner:`/`contact:`), triage of services that are still `unreviewed`, and remediation",
    "dates. Tags are merged into the user tags; nothing users set is overwritten.",
  ].join(" "),
  tags,
  security,
  responses: {
    200: {
      description: "The finished sync with what it changed",
      content: { "application/json": { schema: DefectDojoSyncSchema } },
    },
    401: unauthenticated,
    403: forbidden,
    409: errorResponse("Another sync is running (`DEFECTDOJO_SYNC_RUNNING`)"),
    502: errorResponse("DefectDojo did not answer or refused the token (`DEFECTDOJO_UNAVAILABLE`)"),
    503: errorResponse("DefectDojo is not configured (`DEFECTDOJO_NOT_CONFIGURED`)"),
  },
});

registry.registerPath({
  method: "post",
  path: "/defectdojo/push",
  operationId: "pushToDefectDojo",
  summary: "Push a scan's services to DefectDojo as informational findings",
  description: [
    "Requires `defectdojo:export`. One `Info` finding per service (Generic Findings Import) in the",
    "product `SubSurf discovery`: the first push is an import, later ones reimport into the same",
    "test. A whole-scan push closes findings of services the scan no longer sees (unknown hosts",
    "keep theirs); a push of `hostIds`/`serviceIds` closes nothing. Triage maps to `false_p` and",
    "`verified`; service tags become finding tags.",
  ].join(" "),
  tags,
  security,
  request: { body: { content: { "application/json": { schema: DefectDojoPushBodySchema } } } },
  responses: {
    200: {
      description: "The finished push with DefectDojo's counts",
      content: { "application/json": { schema: DefectDojoPushSchema } },
    },
    400: errorResponse("Validation failed, or nothing to push (`NOTHING_TO_PUSH`)"),
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("Another push is running (`DEFECTDOJO_PUSH_RUNNING`)"),
    502: errorResponse("DefectDojo did not answer or rejected the report (`DEFECTDOJO_UNAVAILABLE`)"),
    503: errorResponse("DefectDojo is not configured (`DEFECTDOJO_NOT_CONFIGURED`)"),
  },
});
