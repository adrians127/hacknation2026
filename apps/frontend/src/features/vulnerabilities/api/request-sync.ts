import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateSources } from "@/features/vulnerabilities/api/invalidate-sources";

export function useRequestSync() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/vulnerabilities/sources/{id}/sync", {
    onSuccess: () => invalidateSources(queryClient),
  });
}
