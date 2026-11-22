import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/api/client";
import { invalidatePipelineQueries } from "@/features/pipelines/api/invalidate";

export function useDeletePipeline() {
  const queryClient = useQueryClient();
  return api.useMutation("delete", "/pipelines/{id}", {
    onSuccess: () => invalidatePipelineQueries(queryClient),
  });
}
