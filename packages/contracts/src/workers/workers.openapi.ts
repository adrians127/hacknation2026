import { registry } from "../../scripts/registry";
import {
  NmapHeartbeatSchema,
  NmapJobSchema,
  NmapLeaseRequestSchema,
  NmapResultSchema,
} from "./workers.schema";

registry.register("NmapJob", NmapJobSchema);
registry.register("NmapResult", NmapResultSchema);

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
    body: { content: { "application/json": { schema: NmapResultSchema } } },
  },
  responses: { 204: { description: "Result accepted" } },
});
