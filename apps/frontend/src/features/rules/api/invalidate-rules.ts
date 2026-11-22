import type { QueryClient } from "@tanstack/react-query";

import { invalidateHosts } from "@/features/hosts/api/invalidate-hosts";

/** A rule change re-applies every rule: triage, tags and change priorities show everywhere. */
export function invalidateRuleEffects(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["get", "/rules"] }),
    queryClient.invalidateQueries({ queryKey: ["post", "/rules/preview"] }),
    queryClient.invalidateQueries({ queryKey: ["get", "/dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["get", "/scans/{id}/changes"] }),
    invalidateHosts(queryClient),
  ]);
}
