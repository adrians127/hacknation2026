import { registry } from "../../scripts/registry";
import {
  cookieAuth,
  errorResponse,
  forbidden,
  unauthenticated,
  validationFailed,
} from "../common/common.openapi";
import { ImportTargetsBodySchema, ImportTargetsResponseSchema } from "./targets.schema";

const tags = ["Targets"];
const security = cookieAuth;

const ImportTargetsResponse = registry.register("ImportTargetsResponse", ImportTargetsResponseSchema);

registry.registerPath({
  method: "post",
  path: "/targets/import",
  operationId: "importTargets",
  summary: "Import IP addresses, CIDR ranges and domains",
  description: [
    "Requires `targets:create`; with `startScan: true` also `scans:run`.",
    "Adds the entries to the target inventory; values already there are counted as `skipped`.",
    "With `startScan`, queues a scan of every entry: domains are resolved to IPv4 addresses and",
    "the addresses are split into scan jobs. Accepts IPv4, CIDRs up to /16 and domains; the body",
    "may be up to 10 MB.",
  ].join(" "),
  tags,
  security,
  request: { body: { content: { "application/json": { schema: ImportTargetsBodySchema } } } },
  responses: {
    201: {
      description: "Entries imported (and a scan queued)",
      content: { "application/json": { schema: ImportTargetsResponse } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    413: errorResponse("Request body larger than 10 MB"),
  },
});
