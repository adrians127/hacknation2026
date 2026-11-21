import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateHosts } from "@/features/hosts/api/invalidate-hosts";

export function useUpdateService() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/hosts/{id}/services/{serviceId}", {
    onSuccess: () => invalidateHosts(queryClient),
  });
}
