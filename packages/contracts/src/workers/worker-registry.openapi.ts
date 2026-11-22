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
  UpdateWorkerBodySchema,
  WorkerListResponseSchema,
  WorkerSchema,
} from "./worker-registry.schema";

const tags = ["Worker registry"];
const security = cookieAuth;

const Worker = registry.register("Worker", WorkerSchema);

registry.registerPath({
  method: "get",
  path: "/workers",
  operationId: "listWorkers",
  summary: "List the workers pipelines are built from, and the worker managers seen",
  description: [
    "Requires `workers:read`. Every worker is registered by a worker-manager's lease request,",
    "with the inputs, split strategies and fields its manifest announces.",
  ].join(" "),
  tags,
  security,
  responses: {
    200: {
      description: "Workers by display name, then managers by last seen",
      content: { "application/json": { schema: WorkerListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "patch",
  path: "/workers/{id}",
  operationId: "updateWorker",
  summary: "Change a worker's display name, description or rate cap",
  description: [
    "Requires `workers:update`. A worker's inputs, split strategies and fields come from the",
    "managers that register it and cannot be changed here.",
  ].join(" "),
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateWorkerBodySchema } } },
  },
  responses: {
    200: { description: "The updated worker", content: { "application/json": { schema: Worker } } },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/workers/{id}",
  operationId: "deleteWorker",
  summary: "Delete a worker no pipeline uses",
  description: "Requires `workers:delete`. A manager that still offers it registers it again.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("Used by a pipeline (`WORKER_IN_USE`)"),
  },
});
