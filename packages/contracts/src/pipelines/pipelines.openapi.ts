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
  PipelineBodySchema,
  PipelineDetailSchema,
  PipelineListResponseSchema,
  PipelineSchema,
  RunPipelineResponseSchema,
  SchedulePreviewBodySchema,
  SchedulePreviewResponseSchema,
  UpdatePipelineBodySchema,
} from "./pipelines.schema";

const tags = ["Pipelines"];
const security = cookieAuth;

const Pipeline = registry.register("Pipeline", PipelineSchema);
const PipelineDetail = registry.register("PipelineDetail", PipelineDetailSchema);

const invalidPipeline = errorResponse(
  "Validation failed: also a disabled worker (`WORKER_DISABLED`), a step input or param the worker does not take, a rate above its cap, or ports outside `SCAN_ALLOWED_PORTS` (`PORTS_NOT_ALLOWED`)",
);

registry.registerPath({
  method: "get",
  path: "/pipelines",
  operationId: "listPipelines",
  summary: "List scan pipelines",
  description: "Requires `pipelines:read`. By name, with their steps, schedule, next and last run.",
  tags,
  security,
  responses: {
    200: {
      description: "All pipelines",
      content: { "application/json": { schema: PipelineListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/pipelines",
  operationId: "createPipeline",
  summary: "Create a pipeline from worker steps",
  description: [
    "Requires `pipelines:create`, and `scans:run` to create it enabled (a schedule that fires).",
    "The first step scans the pipeline's targets; a later one may take the previous step's up",
    "hosts and open ports instead (`input: previous`).",
  ].join(" "),
  tags,
  security,
  request: { body: { content: { "application/json": { schema: PipelineBodySchema } } } },
  responses: {
    201: { description: "The new pipeline", content: { "application/json": { schema: Pipeline } } },
    400: invalidPipeline,
    401: unauthenticated,
    403: forbidden,
    409: errorResponse("Another pipeline has this name (`PIPELINE_NAME_TAKEN`)"),
  },
});

registry.registerPath({
  method: "post",
  path: "/pipelines/schedule/preview",
  operationId: "previewPipelineSchedule",
  summary: "The next run times of a schedule",
  description: "Requires `pipelines:read`. Computed as the scheduler does, from now on.",
  tags,
  security,
  request: { body: { content: { "application/json": { schema: SchedulePreviewBodySchema } } } },
  responses: {
    200: {
      description: "Up to `count` (default 5) run times, in UTC",
      content: { "application/json": { schema: SchedulePreviewResponseSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "get",
  path: "/pipelines/{id}",
  operationId: "getPipeline",
  summary: "Get a pipeline with its recent runs",
  description: "Requires `pipelines:read`.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    200: { description: "The pipeline", content: { "application/json": { schema: PipelineDetail } } },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/pipelines/{id}",
  operationId: "updatePipeline",
  summary: "Change a pipeline",
  description: [
    "Requires `pipelines:update`, and `scans:run` to change `schedule` or `enabled`. `steps`, when",
    "given, replaces every step. Runs already queued keep the steps they started with.",
  ].join(" "),
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdatePipelineBodySchema } } },
  },
  responses: {
    200: { description: "The updated pipeline", content: { "application/json": { schema: Pipeline } } },
    400: invalidPipeline,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("Another pipeline has this name (`PIPELINE_NAME_TAKEN`)"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/pipelines/{id}",
  operationId: "deletePipeline",
  summary: "Delete a pipeline",
  description: "Requires `pipelines:delete`. Its scans and their results stay.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/pipelines/{id}/runs",
  operationId: "runPipeline",
  summary: "Run a pipeline now",
  description: [
    "Requires `scans:run`. Queues a scan of the pipeline's targets with its current steps; a",
    "schedule's time window does not apply to a manual run.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    201: {
      description: "The queued scan",
      content: { "application/json": { schema: RunPipelineResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse(
      "A run is still active (`PIPELINE_RUN_ACTIVE`), nothing to scan (`NO_SCANNABLE_TARGETS`), or a disabled worker (`WORKER_DISABLED`)",
    ),
  },
});
