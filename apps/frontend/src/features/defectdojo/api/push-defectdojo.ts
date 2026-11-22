import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { defectDojoStatusQueryOptions } from "@/features/defectdojo/api/get-defectdojo-status";

export function usePushDefectDojo() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/defectdojo/push", {
    // A failed push is recorded too, so the status is refetched either way.
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: defectDojoStatusQueryOptions().queryKey }),
  });
}
