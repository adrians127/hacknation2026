import { createApiClient } from "@hacknation/api-client";
import createQueryHooks from "openapi-react-query";

import { env } from "@/config/env";

/** Typed fetch client — paths and payloads are checked against contracts' openapi.json. */
export const apiClient = createApiClient(`${env.apiBaseUrl}/v1`, {
  // Auth will be an httpOnly cookie, so the browser must send it cross-origin.
  credentials: "include",
});

/**
 * TanStack Query hooks over the same client, e.g. `api.useQuery("get", "/health")`.
 * Query keys are derived from method + path + params, so there is no key registry to maintain.
 */
export const api = createQueryHooks(apiClient);
