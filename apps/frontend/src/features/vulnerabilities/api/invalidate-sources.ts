import type { QueryClient } from "@tanstack/react-query";

export function invalidateSources(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["get", "/vulnerabilities/sources"] }),
    queryClient.invalidateQueries({ queryKey: ["get", "/vulnerabilities/sources/{id}/runs"] }),
  ]);
}
