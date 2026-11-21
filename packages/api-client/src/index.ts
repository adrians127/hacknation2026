import createClient, { type ClientOptions } from "openapi-fetch";

import type { components, paths } from "./generated/openapi";

export type { components, paths };

/** A response/request schema from the spec by its component name, e.g. `Schema<"HealthResponse">`. */
export type Schema<Name extends keyof components["schemas"]> = components["schemas"][Name];

/**
 * Typed fetch client over the API. Paths, params, bodies and responses are all
 * checked against `openapi.json` at compile time.
 *
 * `baseUrl` must include the API version prefix, e.g. `http://localhost:3001/v1`.
 */
export function createApiClient(baseUrl: string, options: Omit<ClientOptions, "baseUrl"> = {}) {
  return createClient<paths>({ baseUrl, ...options });
}

export type ApiClient = ReturnType<typeof createApiClient>;
