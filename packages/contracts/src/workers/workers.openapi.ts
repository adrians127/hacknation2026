import { registry } from "../../scripts/registry";
import { errorResponse, notFound, validationFailed } from "../common/common.openapi";
import { WorkerResultSchema } from "./worker-result.schema";
import {
  ManagerJobListSchema,
  ManagerLeaseRequestSchema,
  ManagerResultUploadResponseSchema,
  ManagerResultUploadSchema,
  NmapHeartbeatSchema,
  NmapJobSchema,
  NmapLeaseRequestSchema,
} from "./workers.schema";

registry.register("NmapJob", NmapJobSchema);
registry.register("WorkerResult", WorkerResultSchema);
const ManagerLeaseRequest = registry.register("ManagerLeaseRequest", ManagerLeaseRequestSchema);
const ManagerJobList = registry.register("ManagerJobList", ManagerJobListSchema);
const ManagerResultUpload = registry.register("ManagerResultUpload", ManagerResultUploadSchema);
const ManagerResultUploadResponse = registry.register(
  "ManagerResultUploadResponse",
  ManagerResultUploadResponseSchema,
);

registry.registerPath({
  method: "post",
  path: "/workers/manager/lease",
  operationId: "leaseManagerJobs",
  summary: "Lease queued scan jobs to a worker-manager (long poll)",
  description: [
    "Called by worker-manager in `--poll` mode with `Authorization: Bearer <WORKER_TOKEN>`.",
    "Records the manager and the workers it offers (unknown names become disabled custom",
    "workers), then leases up to `max_parallel` × `WORKER_LEASE_JOBS_PER_SLOT` queued jobs of",
    "running scans whose worker is enabled and offered. Without work it holds the request for up",
    "to `wait_seconds` (at most 60) and answers 204. Each job's `deadline` is capped by the scan's",
    "time window; its lease lasts until the deadline plus `WORKER_LEASE_GRACE_SECONDS`.",
  ].join(" "),
  tags: ["Workers"],
  security: [{ workerToken: [] }],
  request: { body: { content: { "application/json": { schema: ManagerLeaseRequest } } } },
  responses: {
    200: {
      description: "Leased jobs, in worker-manager's job list format",
      content: { "application/json": { schema: ManagerJobList } },
    },
    204: { description: "No work within `wait_seconds`" },
    400: validationFailed,
    401: errorResponse("Missing or wrong worker token"),
    503: errorResponse("Worker endpoints are disabled: the backend has no WORKER_TOKEN"),
  },
});

registry.registerPath({
  method: "post",
  path: "/workers/manager/results",
  operationId: "submitManagerResult",
  summary: "Upload one worker run's result",
  description: [
    "Called by worker-manager with `Authorization: Bearer <WORKER_TOKEN>` after each task.",
    "`result` is the locked format of docs/worker-result-format.md. A leased job split into",
    "tasks comes back as one upload per task, all with the job's `jobId` and `leaseId`;",
    "`task_index` tells them apart. Resending the same lease and task is a no-op. Every",
    "address must be inside the job's targets and every open port inside the scan's ports.",
    "The body may be up to 64 MB and gzip-compressed (`Content-Encoding: gzip`).",
  ].join(" "),
  tags: ["Workers"],
  security: [{ workerToken: [] }],
  request: { body: { content: { "application/json": { schema: ManagerResultUpload } } } },
  responses: {
    200: {
      description: "Result stored, or already stored for this lease and task",
      content: { "application/json": { schema: ManagerResultUploadResponse } },
    },
    400: validationFailed,
    401: errorResponse("Missing or wrong worker token"),
    404: notFound,
    413: errorResponse("Body larger than 64 MB"),
    503: errorResponse("Worker endpoints are disabled: the backend has no WORKER_TOKEN"),
  },
});

registry.registerPath({
  method: "post",
  path: "/workers/nmap/lease",
  operationId: "leaseNmapJob",
  tags: ["Workers"],
  security: [{ workerToken: [] }],
  request: {
    body: { content: { "application/json": { schema: NmapLeaseRequestSchema } } },
  },
  responses: {
    200: {
      description: "Leased Nmap job",
      content: { "application/json": { schema: NmapJobSchema } },
    },
    204: { description: "No Nmap job is available" },
  },
});

registry.registerPath({
  method: "post",
  path: "/workers/nmap/heartbeat",
  operationId: "heartbeatNmapJob",
  tags: ["Workers"],
  security: [{ workerToken: [] }],
  request: {
    body: { content: { "application/json": { schema: NmapHeartbeatSchema } } },
  },
  responses: { 204: { description: "Lease extended" } },
});

registry.registerPath({
  method: "post",
  path: "/workers/nmap/results",
  operationId: "submitNmapResult",
  tags: ["Workers"],
  security: [{ workerToken: [] }],
  request: {
    body: { content: { "application/json": { schema: WorkerResultSchema } } },
  },
  description: "The locked result format in docs/worker-result-format.md.",
  responses: { 204: { description: "Result accepted" } },
});
