import type { QueryClient } from "@tanstack/react-query";

import { invalidateHosts } from "@/features/hosts/api/invalidate-hosts";

/** Signature changes re-evaluate scans: matches show in host views, the dashboard and reports. */
export function invalidateSignatureEffects(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["get", "/signatures"] }),
    queryClient.invalidateQueries({ queryKey: ["post", "/signatures/preview"] }),
    queryClient.invalidateQueries({ queryKey: ["get", "/dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["get", "/scans/{id}/changes"] }),
    queryClient.invalidateQueries({
      predicate: ({ queryKey: [, path] }) => typeof path === "string" && path.startsWith("/reports/"),
    }),
    invalidateHosts(queryClient),
  ]);
}
