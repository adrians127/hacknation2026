import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { defectDojoStatusQueryOptions } from "@/features/defectdojo/api/get-defectdojo-status";
import { invalidateHosts } from "@/features/hosts/api/invalidate-hosts";

export function useSyncDefectDojo() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/defectdojo/sync", {
    // A failed sync is recorded too, so the status is refetched either way.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: defectDojoStatusQueryOptions().queryKey }),
        invalidateHosts(queryClient),
      ]),
  });
}
