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
  HostEditsSchema,
  HostServiceParamsSchema,
  ServiceEditsSchema,
  UpdateHostBodySchema,
  UpdateServiceBodySchema,
} from "./hosts.schema";

const tags = ["Hosts"];
const security = cookieAuth;

registry.registerPath({
  method: "patch",
  path: "/hosts/{id}",
  operationId: "updateHost",
  summary: "Edit a host's note, tags or triage status",
  description: [
    "Requires `hosts:update`. These fields belong to users: later scans never change them.",
    "The note is encrypted at rest.",
  ].join(" "),
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateHostBodySchema } } },
  },
  responses: {
    200: {
      description: "The host's user-owned fields",
      content: { "application/json": { schema: HostEditsSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/hosts/{id}/services/{serviceId}",
  operationId: "updateHostService",
  summary: "Edit a service, or correct what the scanner identified",
  description: [
    "Requires `hosts:update`. Note, tags, triage status and corrections of the service name,",
    "product and version (`null` removes a correction). Later scans never change these fields.",
  ].join(" "),
  tags,
  security,
  request: {
    params: HostServiceParamsSchema,
    body: { content: { "application/json": { schema: UpdateServiceBodySchema } } },
  },
  responses: {
    200: {
      description: "The service's user-owned fields",
      content: { "application/json": { schema: ServiceEditsSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});
