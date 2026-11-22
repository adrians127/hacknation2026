import { registry } from "../../scripts/registry";
import { cookieAuth, forbidden, unauthenticated } from "../common/common.openapi";
import { DashboardResponseSchema } from "./dashboard.schema";

registry.registerPath({
  method: "get",
  path: "/dashboard",
  operationId: "getDashboard",
  summary: "The most important findings of the newest scan",
  description: [
    "Requires `scans:read`. The newest scan with results compared with the previous one: host",
    "counts, the lifecycle of every known host, and the changes that deserve a look first.",
  ].join(" "),
  tags: ["Dashboard"],
  security: cookieAuth,
  responses: {
    200: {
      description: "The dashboard",
      content: { "application/json": { schema: DashboardResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});
