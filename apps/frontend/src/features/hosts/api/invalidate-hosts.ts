import type { QueryClient } from "@tanstack/react-query";

/** The list and every host detail: an edit can change both. */
export function invalidateHosts(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["get", "/hosts"] }),
    queryClient.invalidateQueries({ queryKey: ["get", "/hosts/{id}"] }),
  ]);
}
