import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidateHosts } from "@/features/hosts/api/invalidate-hosts";

export function useTagScanHosts() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/scans/{id}/hosts/tags", {
    onSuccess: () => invalidateHosts(queryClient),
  });
}
