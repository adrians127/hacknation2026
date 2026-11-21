import type { QueryClient } from "@tanstack/react-query";

/** Edits show in every scan's host list and host detail, so all of them are refetched. */
export function invalidateHosts(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["get", "/scans/{id}/hosts"] }),
    queryClient.invalidateQueries({ queryKey: ["get", "/scans/{id}/hosts/{hostId}"] }),
  ]);
}
