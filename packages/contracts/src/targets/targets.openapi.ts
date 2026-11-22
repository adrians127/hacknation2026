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
  ImportTargetsBodySchema,
  ImportTargetsResponseSchema,
  TargetListResponseSchema,
  TargetSchema,
  UpdateTargetBodySchema,
} from "./targets.schema";

const tags = ["Targets"];
const security = cookieAuth;

const Target = registry.register("Target", TargetSchema);
const ImportTargetsResponse = registry.register("ImportTargetsResponse", ImportTargetsResponseSchema);

registry.registerPath({
  method: "get",
  path: "/targets",
  operationId: "listTargets",
  summary: "List the target inventory",
  description: [
    "Requires `targets:read`. Every target by value. `lastScanAt` is when the newest scan that",
    "covered the target started; `activeHosts` counts the addresses up in that scan (for a domain:",
    "the addresses it resolved to).",
  ].join(" "),
  tags,
  security,
  responses: {
    200: {
      description: "All targets",
      content: { "application/json": { schema: TargetListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "patch",
  path: "/targets/{id}",
  operationId: "updateTarget",
  summary: "Change a target's note or tags",
  description: "Requires `targets:update`. `tags` replaces all of the target's tags.",
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateTargetBodySchema } } },
  },
  responses: {
    200: { description: "The changed target", content: { "application/json": { schema: Target } } },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/targets/{id}",
  operationId: "deleteTarget",
  summary: "Remove a target from the inventory",
  description: [
    "Requires `targets:delete`. Scans that covered it keep their jobs and results; pipelines",
    "stop scanning it.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    204: { description: "Target removed" },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/targets/import",
  operationId: "importTargets",
  summary: "Import IP addresses, CIDR ranges, IP ranges and domains",
  description: [
    "Requires `targets:create`; with `startScan: true` also `scans:run`.",
    "Adds the entries to the target inventory; values already there are counted as `skipped`",
    "and keep their note and tags (`tags` only go to the targets this import creates).",
    "With `startScan`, queues a scan of every entry: domains are resolved to IPv4 addresses and",
    "the addresses are split into scan jobs. Accepts IPv4, CIDRs up to /16, IPv4 ranges",
    "(`10.0.0.1-10.0.0.200`, stored as the CIDR blocks that cover them) and domains; the body",
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
