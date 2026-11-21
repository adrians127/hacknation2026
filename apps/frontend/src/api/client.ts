import { createApiClient, type Middleware } from "@hacknation/api-client";
import createQueryHooks from "openapi-react-query";

import { env } from "@/config/env";

const baseUrl = `${env.apiBaseUrl}/v1`;

/** Typed fetch client — paths and payloads are checked against contracts' openapi.json. */
export const apiClient = createApiClient(baseUrl, {
  // Auth is a pair of httpOnly cookies, so the browser must send them cross-origin.
  credentials: "include",
});

// A 401 from these means "wrong credentials" or "no session", never "access token expired".
const SESSION_ENDPOINTS = new Set(["/auth/login", "/auth/refresh", "/auth/logout"]);

let refreshInFlight: Promise<boolean> | null = null;
let onSessionExpired: (() => void) | null = null;

/** Called once refreshing fails, i.e. the user has to sign in again. Registered by the app. */
export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

/** One refresh at a time: parallel 401s share it, so the refresh token is rotated once. */
function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch(`${baseUrl}/auth/refresh`, { method: "POST", credentials: "include" })
    .then(
      (res) => res.ok,
      () => false,
    )
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

// The body of a sent Request can be read only once, so keep a clone for the retry.
const pendingRetries = new Map<string, Request>();

const sessionMiddleware: Middleware = {
  onRequest({ request, schemaPath, id }) {
    if (!SESSION_ENDPOINTS.has(schemaPath)) pendingRetries.set(id, request.clone());
  },
  async onResponse({ response, id }) {
    const retry = pendingRetries.get(id);
    pendingRetries.delete(id);
    if (response.status !== 401 || !retry) return response;

    if (await refreshSession()) return fetch(retry);
    onSessionExpired?.();
    return response;
  },
  onError({ id }) {
    pendingRetries.delete(id);
  },
};

apiClient.use(sessionMiddleware);

/**
 * TanStack Query hooks over the same client, e.g. `api.useQuery("get", "/health")`.
 * Query keys are derived from method + path + params, so there is no key registry to maintain.
 */
export const api = createQueryHooks(apiClient);
