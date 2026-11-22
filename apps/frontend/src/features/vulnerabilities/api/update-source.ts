import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateSources } from "@/features/vulnerabilities/api/invalidate-sources";

export function useUpdateSource() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/vulnerabilities/sources/{id}", {
    onSuccess: () => invalidateSources(queryClient),
  });
}
