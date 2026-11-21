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
  HostDetailSchema,
  HostListQuerySchema,
  HostListResponseSchema,
  HostServiceParamsSchema,
  ServiceDetailSchema,
  UpdateHostBodySchema,
  UpdateServiceBodySchema,
} from "./hosts.schema";

const tags = ["Hosts"];
const security = cookieAuth;
const HostDetail = registry.register("HostDetail", HostDetailSchema);
const ServiceDetail = registry.register("ServiceDetail", ServiceDetailSchema);
const hostResponse = {
  description: "The host with its services, decrypted details and scan history",
  content: { "application/json": { schema: HostDetail } },
};

registry.registerPath({
  method: "get",
  path: "/hosts",
  operationId: "listHosts",
  summary: "List hosts and their services",
  description: [
    "Requires `hosts:read`. Every address that has been `up` in some scan, in address order.",
    "`q` matches an IP prefix, a hostname, a tag, a port number or a service name/product.",
  ].join(" "),
  tags,
  security,
  request: { query: HostListQuerySchema },
  responses: {
    200: {
      description: "One page of hosts",
      content: { "application/json": { schema: HostListResponseSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/hosts/{id}",
  operationId: "getHost",
  summary: "Get a host",
  description: "Requires `hosts:read`.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: { 200: hostResponse, 401: unauthenticated, 403: forbidden, 404: notFound },
});

registry.registerPath({
  method: "patch",
  path: "/hosts/{id}",
  operationId: "updateHost",
  summary: "Edit a host's note, tags or triage status",
  description:
    "Requires `hosts:update`. These fields belong to users: later scans never change them. The note is encrypted at rest.",
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateHostBodySchema } } },
  },
  responses: {
    200: hostResponse,
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
      description: "The service",
      content: { "application/json": { schema: ServiceDetail } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});
