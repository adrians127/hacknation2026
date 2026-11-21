import { QueryClient } from "@tanstack/react-query";

import { toApiError } from "@/lib/api-error";

// Retrying these cannot succeed: the session, the permission or the resource is missing.
const NOT_RETRYABLE = new Set([401, 403, 404]);

/** Single shared React Query client for the app. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) =>
        failureCount < 1 && !NOT_RETRYABLE.has(toApiError(error)?.status ?? 0),
    },
  },
});
