import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateHosts } from "@/features/hosts/api/invalidate-hosts";

export function useUpdateHost() {
  const queryClient = useQueryClient();
  return api.useMutation("patch", "/hosts/{id}", {
    onSuccess: () => invalidateHosts(queryClient),
  });
}
