import { registry } from "../../scripts/registry";
import { WorkerResultSchema } from "./worker-result.schema";
import { NmapHeartbeatSchema, NmapJobSchema, NmapLeaseRequestSchema } from "./workers.schema";

registry.register("NmapJob", NmapJobSchema);
registry.register("WorkerResult", WorkerResultSchema);

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
