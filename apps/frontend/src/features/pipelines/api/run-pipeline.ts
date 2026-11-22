import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidatePipelineQueries } from "@/features/pipelines/api/invalidate";

export function useRunPipeline() {
  const queryClient = useQueryClient();
  return api.useMutation("post", "/pipelines/{id}/runs", {
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}
