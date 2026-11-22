import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateHosts } from "@/features/hosts/api/invalidate-hosts";

/** Triage shows in every scan's host list (counts) and host detail. */
export function useUpdateVulnerabilityTriage() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/vulnerabilities/services/{serviceId}/{canonicalId}", {
    onSuccess: () => invalidateHosts(queryClient),
  });
}
