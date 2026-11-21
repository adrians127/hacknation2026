import { registry } from "../../scripts/registry";
import { HealthResponseSchema } from "./health.schema";

registry.register("HealthResponse", HealthResponseSchema);

registry.registerPath({
  method: "get",
  path: "/health",
  operationId: "getHealth",
  tags: ["Health"],
  summary: "Service and database health",
  responses: {
    200: {
      description: "Service is up; `database` tells whether PostgreSQL answered",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});
