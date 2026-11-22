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
    "Requires `workers:read`. Built-in workers come from the code catalog; a name a manager",
    "offers that the catalog lacks is registered as a disabled custom worker.",
  ].join(" "),
  tags,
  security,
  responses: {
    200: {
      description: "Workers by stage, then managers by last seen",
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
  summary: "Enable or disable a worker, or change its rate cap and defaults",
  description: [
    "Requires `workers:update`. A built-in worker accepts only `enabled`, `maxRate` and",
    "`defaults`; a custom one also its description, stage, inputs, split strategies and fields.",
    "`defaults` must match the worker's fields.",
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
    409: errorResponse("A built-in worker's definition cannot change (`WORKER_BUILTIN`)"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/workers/{id}",
  operationId: "deleteWorker",
  summary: "Delete a custom worker no pipeline uses",
  description: "Requires `workers:delete`.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("Built-in (`WORKER_BUILTIN`) or used by a pipeline (`WORKER_IN_USE`)"),
  },
});
